// Seam 2 for the Snag report (RP-677, spec RP-619; migration 20270923000000_snag_report.sql; visibility.md
// V3, scenario RP-677-2), as the app role: a report's snapshot is read by nobody through the table; its asker
// alone learns where it is (app.snag_report_state), another Member of the same Project, a Member of no
// Project and a made-up id learn nothing; only the worker, with no Member set, reads what to print and saves
// the PDF; and a Member who is not on the Project cannot ask for a report of it.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let projectId = "";
let asker = "";
let colleague = "";
let outsider = "";

const content = { projectName: { en: "P", ar: "م" }, items: [], capped: false };
const sha = (s: string) => createHash("sha256").update(s).digest();

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

const request = (memberId: string, project: string) =>
  withMember(app, memberId, async (trx) => {
    const { rows } = await sql<{ id: string | null }>`select app.request_snag_report(${project}::uuid, 'en', ${JSON.stringify(content)}::jsonb) as id`.execute(trx);
    return rows[0]!.id;
  });

const state = (memberId: string, id: string) =>
  withMember(app, memberId, async (trx) => (await sql<{ status: string; storage_key: string | null }>`select status, storage_key from app.snag_report_state(${id}::uuid)`.execute(trx)).rows);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // A Project with two active Members, and an active Member who is on none of its Participants.
  const { rows } = await migrator.query<{ project_id: string; members: string[] }>(
    `select pm.project_id, array_agg(distinct pm.member_id order by pm.member_id) as members
     from project_member pm join member m on m.id = pm.member_id and m.status = 'active'
     where pm.status = 'active' group by pm.project_id having count(distinct pm.member_id) >= 2 limit 1`,
  );
  projectId = rows[0]!.project_id;
  [asker, colleague] = rows[0]!.members as [string, string];
  const { rows: others } = await migrator.query<{ id: string }>(
    `select m.id from member m where m.status = 'active'
     and not exists (select 1 from project_member pm where pm.member_id = m.id and pm.project_id = $1 and pm.status = 'active') limit 1`,
    [projectId],
  );
  outsider = others[0]!.id;
  expect(asker && colleague && outsider).toBeTruthy();
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("the snag_report table", () => {
  it("is not read by the app role at all: the snapshot goes to the worker through its function only", async () => {
    expect(await failure(asker, sql`select * from snag_report`)).toBe("42501");
    expect(await failure(null, sql`select id from snag_report`)).toBe("42501");
  });
});

describe("a report, from request to PDF", () => {
  let id = "";
  let outbox = "";

  it("is asked for by a Member of the Project only", async () => {
    expect(await request(outsider, projectId)).toBeNull();
    id = (await request(asker, projectId))!;
    expect(id).toBeTruthy();
    const { rows } = await migrator.query<{ id: string }>("select outbox_id as id from snag_report where id = $1", [id]);
    outbox = rows[0]!.id;
    // The job row holds ids only, never an item's text.
    const job = await migrator.query<{ kind: string; payload: unknown }>("select kind, payload from outbox where id = $1", [outbox]);
    expect(job.rows[0]).toEqual({ kind: "snag_report", payload: { snag_report_id: id } });
  });

  it("is preparing to its asker, and nothing to a colleague on the Project, a Member of no Project and a made-up id", async () => {
    expect(await state(asker, id)).toEqual([{ status: "preparing", storage_key: null }]);
    expect(await state(colleague, id)).toEqual([]);
    expect(await state(outsider, id)).toEqual([]);
    expect(await state(asker, randomUUID())).toEqual([]);
  });

  it("is printed from the snapshot by the worker alone", async () => {
    const job = (memberId: string | null) => failure(memberId, sql`select * from app.snag_report_job(${outbox}::uuid)`);
    expect(await job(asker)).toBe("42501");
    expect(await job(null)).toBeNull();
    expect(await failure(asker, sql`select app.save_snag_report(${outbox}::uuid, 'k', ${sha("x")}, 1)`)).toBe("42501");
  });

  it("is ready to its asker once the worker saves the PDF, still nothing to anyone else, and is saved once", async () => {
    const key = `projects/${projectId}/snag-reports/${id}/snag-report.pdf`;
    const save = () => sql<{ saved: boolean }>`select app.save_snag_report(${outbox}::uuid, ${key}, ${sha(key)}, 10) as saved`.execute(app).then((r) => r.rows[0]!.saved);
    expect(await save()).toBe(true);
    expect(await save()).toBe(false);
    expect(await state(asker, id)).toEqual([{ status: "ready", storage_key: key }]);
    expect(await state(colleague, id)).toEqual([]);
    expect(await state(outsider, id)).toEqual([]);
    const job = await sql`select * from app.snag_report_job(${outbox}::uuid)`.execute(app);
    expect(job.rows).toEqual([]);
  });
});
