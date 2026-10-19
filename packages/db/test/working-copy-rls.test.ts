// Seam 2 for the Working Copy (RP-621, spec RP-632; visibility.md, the Working Copy row), as the
// app role: the working_copy table is never read or written directly, what a copy prints is read
// only inside the definer functions, a Member asks only for an item they see, and only the worker,
// with no Member set, reads a job's content and keeps where its PDF is.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let itemId = "";
let projectId = "";
let seer = "";
let other = "";

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
  // An open Submitted demo item, one Member who sees it and one active Member who doesn't.
  const { rows: items } = await migrator.query<{ id: string; project_id: string }>(
    "select id, project_id from work_item where submitted_at is not null and closed_at is null and discarded_at is null order by id limit 1",
  );
  itemId = items[0]!.id;
  projectId = items[0]!.project_id;
  const { rows: members } = await migrator.query<{ id: string }>("select id from member where status = 'active' order by id");
  for (const { id } of members) {
    const sees = await withMember(app, id, (trx) => sql<{ sees: boolean }>`select app.sees_work_item(${itemId}::uuid) as sees`.execute(trx)).then((r) => r.rows[0]!.sees);
    if (sees && !seer) seer = id;
    if (!sees && !other) other = id;
    if (seer && other) break;
  }
  expect(seer && other).toBeTruthy();
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
    const { rows: members } = await migrator.query<{ id: string }>(
      `select pm.member_id as id from project_member pm
       where pm.project_id = $1 and pm.status = 'active'
         and not exists (select 1 from project_admin pa where pa.project_id = pm.project_id and pa.member_id = pm.member_id)
       order by pm.member_id limit 1`,
      [projectId],
    );
    const nonAdmin = members[0]!.id;
    const { rows } = await withMember(app, nonAdmin, (trx) =>
      sql<{ outcome: string }>`select app.set_project_working_copy_watermark(${projectId}::uuid, ${JSON.stringify({ en: "Mine", ar: "لي" })}::jsonb) as outcome`.execute(trx),
    );
    expect(rows[0]!.outcome).toBe("not_found");
    const { rows: project } = await migrator.query<{ watermark: unknown }>("select working_copy_watermark as watermark from project where id = $1", [projectId]);
    expect(project[0]!.watermark).toEqual({ en: "Not Final", ar: "غير نهائي" });
  });
});
