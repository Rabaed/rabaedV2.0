// Seam 2 for the Working Copy (RP-621, spec RP-632; visibility.md, the Working Copy row), as the
// app role: the working_copy table is never read or written directly, what a copy prints is read
// only inside the definer functions, a Member asks only for an item they see, and only the worker,
// with no Member set, reads a job's content and keeps where its PDF is.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower;
let itemId = "";
let projectId = "";
let seer = "";
let other = "";
/** An item `other` sees: the positive control beside each refusal to `other`. */
let othersItemId = "";

/** The error code `query` fails with as Member `memberId` (or as the worker, with none), or null. */
async function failure(memberId: string | null, query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    if (memberId) await withMember(app, memberId, (trx) => query.execute(trx));
    else await query.execute(app);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const request = (memberId: string, id: string) =>
  withMember(app, memberId, (trx) =>
    sql<{ outcome: string; storage_key: string | null }>`select outcome, storage_key from app.request_working_copy(${id}::uuid, 'test')`.execute(trx),
  ).then((r) => r.rows[0]!);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // This file's own Tower (RP-995): C1's open Submitted WIR, which K1's Engineer holds and sees, and C2's Engineer,
  // another Contractor of the same Trade, doesn't (V3). C2's own Draft is the positive control beside that refusal.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RWC" });
  projectId = tower.projectId;
  itemId = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
  seer = tower.k1.members.engineer;
  other = tower.c2.members.engineer;
  othersItemId = await c2Draft(tower, { type: "WIR", title: "Column pour" });
});

afterAll(async () => {
  // The rows asked for here are this test's own.
  await migrator.query("delete from working_copy where app_version = 'test'");
  await migrator.query("delete from outbox where kind = 'working_copy' and project_id = $1 and processed_at is null", [projectId]);
  await migrator.end();
  await app.destroy();
});

describe("the working_copy table", () => {
  it("is not read or written by the app role at all", async () => {
    expect(await failure(seer, sql`select * from working_copy`)).toBe("42501");
    expect(await failure(null, sql`select id from working_copy`)).toBe("42501");
    expect(
      await failure(
        null,
        sql`insert into working_copy (work_item_id, project_id, content_sha256, app_version) values (${itemId}::uuid, ${projectId}::uuid, ${Buffer.alloc(32)}, 'x')`,
      ),
    ).toBe("42501");
  });
});

describe("what a Working Copy prints", () => {
  it("is read only inside the definer functions, never by the app role", async () => {
    expect(await failure(seer, sql`select app.working_copy_content(${itemId}::uuid)`)).toBe("42501");
    expect(await failure(null, sql`select app.working_copy_content(${itemId}::uuid)`)).toBe("42501");
    expect(await failure(seer, sql`select app.working_copy_draft_answers(${itemId}::uuid)`)).toBe("42501");
  });
});

describe("app.request_working_copy", () => {
  it("is not_found for a Member who doesn't see the item, and for a made-up id, and queues nothing", async () => {
    expect(await request(other, itemId)).toEqual({ outcome: "not_found", storage_key: null });
    expect(await request(seer, randomUUID())).toEqual({ outcome: "not_found", storage_key: null });
    const { rows } = await migrator.query("select 1 from working_copy where work_item_id = $1 and app_version = 'test'", [itemId]);
    expect(rows).toEqual([]);
    // Positive controls: the refused Member is answered for an item they see, and the seer is refused C2's Draft.
    expect(await request(other, othersItemId)).toEqual({ outcome: "preparing", storage_key: null });
    expect(await request(seer, othersItemId)).toEqual({ outcome: "not_found", storage_key: null });
  });

  it("queues one job for a Member who sees the item, however often it is asked", async () => {
    expect(await request(seer, itemId)).toEqual({ outcome: "preparing", storage_key: null });
    expect(await request(seer, itemId)).toEqual({ outcome: "preparing", storage_key: null });
    const { rows } = await migrator.query<{ jobs: string }>(
      `select count(*) as jobs from outbox o join working_copy c on c.outbox_id = o.id
       where c.work_item_id = $1 and c.app_version = 'test' and o.kind = 'working_copy'`,
      [itemId],
    );
    expect(rows[0]!.jobs).toBe("1");
  });

  it("checks access on every ask: once printed, the Member who sees it gets its key, and the one who doesn't gets not_found", async () => {
    // As the worker would have printed it (the migrator stands in for it here).
    await migrator.query(
      "update working_copy set storage_key = 'projects/p/work-items/w/documental-record/working-copies/x.pdf', made_at = now() where work_item_id = $1 and app_version = 'test'",
      [itemId],
    );
    expect(await request(seer, itemId)).toEqual({ outcome: "ready", storage_key: "projects/p/work-items/w/documental-record/working-copies/x.pdf" });
    expect(await request(other, itemId)).toEqual({ outcome: "not_found", storage_key: null });
    expect(await request(other, othersItemId)).toEqual({ outcome: "preparing", storage_key: null });
  });

  it("is refused without a Member set: the worker asks for nothing", async () => {
    const { rows } = await sql<{ outcome: string }>`select outcome from app.request_working_copy(${itemId}::uuid, 'test')`.execute(app);
    expect(rows[0]!.outcome).toBe("not_found");
  });
});

describe("the worker's functions", () => {
  it("refuse a Member", async () => {
    expect(await failure(seer, sql`select app.working_copy_job(${randomUUID()}::uuid)`)).toBe("42501");
    expect(await failure(seer, sql`select app.save_working_copy(${randomUUID()}::uuid, 'k')`)).toBe("42501");
  });

  it("give nothing for a row that is no Working Copy job", async () => {
    const { rows } = await sql<{ job: unknown; saved: boolean }>`
      select app.working_copy_job(${randomUUID()}::uuid) as job, app.save_working_copy(${randomUUID()}::uuid, 'k') as saved
    `.execute(app);
    expect(rows[0]).toEqual({ job: null, saved: false });
  });
});

describe("app.set_project_working_copy_watermark", () => {
  it("is not_found for a Member who is no Project Admin, and changes nothing", async () => {
    // A Member of the Project who is none of its Project Admins (whether they see the item has nothing to do with it).
    const nonAdmin = tower.c1.members.engineer;
    const { rows: admins } = await migrator.query("select 1 from project_admin where project_id = $1 and member_id = $2", [projectId, nonAdmin]);
    expect(admins).toEqual([]);
    const watermark = (as: string, text: string) =>
      withMember(app, as, (trx) =>
        sql<{ outcome: string }>`select app.set_project_working_copy_watermark(${projectId}::uuid, ${JSON.stringify({ en: text, ar: text })}::jsonb) as outcome`.execute(trx),
      ).then((r) => r.rows[0]!.outcome);
    const watermarkNow = async () =>
      (await migrator.query<{ watermark: unknown }>("select working_copy_watermark as watermark from project where id = $1", [projectId])).rows[0]!.watermark;
    expect(await watermark(nonAdmin, "Mine")).toBe("not_found");
    expect(await watermarkNow()).toEqual({ en: "Not Final", ar: "غير نهائي" });
    // Positive control: the Project's Admin (C1's Authorized Person, its creator) does change it.
    expect(await watermark(tower.c1.ap, "Theirs")).toBe("set");
    expect(await watermarkNow()).toEqual({ en: "Theirs", ar: "Theirs" });
  });
});
