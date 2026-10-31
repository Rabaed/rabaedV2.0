// Seam 2 for the Documental Record's checks, "record ready" and Re-produce (scenario RP-155-3; RP-155, spec
// RP-632; ADR 0023; migration 20270805000000_record_checks.sql), as the app role: what the
// checks found and the history of replaced PDFs are admin-only, the worker's functions refuse
// a Member, Rabaed Admin's refuse the app role, and a record changes only as its checks and
// a Re-produce change it.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let admin: pg.Client;
let app: Db;
let itemId = "";
let recordId = "";
let seer = "";
let other = "";
/** An item `other` sees, with its own record: the positive control beside each refusal to `other`. */
let othersItemId = "";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Gives item `id` of Project `projectId` a record still preparing, as the worker saves one (the migrator stands in for it); returns its id. */
async function preparingRecord(projectId: string, id: string, code: string): Promise<string> {
  const key = `projects/${projectId}/work-items/${id}/documental-record/record.pdf`;
  const file = async (k: string, mime: string) =>
    (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime])).rows[0]!.id;
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  return (
    await migrator.query<{ id: string }>(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
       values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, $7, 'preparing') returning id`,
      [projectId, id, pdf, data, sha("pdf"), sha(randomUUID()), code],
    )
  ).rows[0]!.id;
}

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

const stateOf = (memberId: string | null, id = itemId) =>
  (memberId
    ? withMember(app, memberId, (trx) => sql<{ state: string | null }>`select app.documental_record_state(${id}::uuid) as state`.execute(trx))
    : sql<{ state: string | null }>`select app.documental_record_state(${id}::uuid) as state`.execute(app)
  ).then((r) => r.rows[0]!.state);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  app = createDb(urls.app, { max: 2 });
  // This file's own Tower (RP-995): C1's Submitted WIR, which K1's Engineer holds and sees, and C2's Engineer,
  // another Contractor of the same Trade, doesn't (V3). C2's own Draft is the positive control beside that refusal.
  const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RDC" });
  itemId = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
  seer = tower.k1.members.engineer;
  other = tower.c2.members.engineer;
  othersItemId = await c2Draft(tower, { type: "WIR", title: "Column pour" });
  recordId = await preparingRecord(tower.projectId, itemId, "ABCD-EF56");
  await preparingRecord(tower.projectId, othersItemId, "ABCD-EF57");
});

afterAll(async () => {
  await Promise.all([migrator.end(), admin.end(), app.destroy()]);
});

describe("scenario RP-155-3: what the checks found and the replaced PDFs", () => {
  it("are not read by the app role at all", async () => {
    for (const table of ["documental_record_check", "documental_record_reproduction"]) {
      expect(await failure(seer, sql.raw(`select * from ${table}`)), table).toBe("42501");
      expect(await failure(null, sql.raw(`select id from ${table}`)), `${table} as the worker`).toBe("42501");
      expect(await failure(seer, sql.raw(`insert into ${table} (id) values (gen_random_uuid())`)), `${table} insert`).toBe("42501");
    }
  });

  it("are readable by Rabaed Admin's role but written only through the worker's functions, and never changed", async () => {
    await expect(admin.query("select count(*) from documental_record_check")).resolves.toBeTruthy();
    await expect(admin.query("select count(*) from documental_record_reproduction")).resolves.toBeTruthy();
    await expect(admin.query("insert into documental_record_check (documental_record_id, run_kind, passed) values ($1, 'closure', true)", [recordId])).rejects.toMatchObject({ code: "42501" });
    await migrator.query("insert into documental_record_check (documental_record_id, run_kind, passed) values ($1, 'closure', true)", [recordId]);
    await expect(migrator.query("update documental_record_check set passed = false where documental_record_id = $1", [recordId])).rejects.toMatchObject({ code: "42501" });
    await expect(migrator.query("delete from documental_record_check where documental_record_id = $1", [recordId])).rejects.toMatchObject({ code: "42501" });
  });

  it("can't record a failed check without saying what failed, or a pass with a finding", async () => {
    await expect(migrator.query("insert into documental_record_check (documental_record_id, run_kind, passed) values ($1, 'closure', false)", [recordId])).rejects.toMatchObject({ code: "23514" });
    await expect(
      migrator.query("insert into documental_record_check (documental_record_id, run_kind, passed, problems) values ($1, 'closure', true, '[\"x\"]')", [recordId]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("the worker's functions", () => {
  it("refuse a caller with a Member set", async () => {
    const outbox = randomUUID();
    expect(await failure(seer, sql`select app.finish_documental_record(${outbox}::uuid, true, '[]'::jsonb)`)).toBe("42501");
    expect(await failure(seer, sql`select app.deliver_record_ready(${outbox}::uuid)`)).toBe("42501");
    expect(await failure(seer, sql`select app.documental_record_reproduction_source(${outbox}::uuid)`)).toBe("42501");
    expect(
      await failure(seer, sql`select app.reproduce_documental_record(${outbox}::uuid, 'k', ${sha("a")}, 1, ${sha("b")}, 1, now(), true, '[]'::jsonb)`),
    ).toBe("42501");
  });

  it("give nothing for an outbox row that isn't theirs", async () => {
    const outbox = randomUUID();
    expect((await sql<{ done: boolean }>`select app.finish_documental_record(${outbox}::uuid, true, '[]'::jsonb) as done`.execute(app)).rows[0]!.done).toBe(false);
    expect((await sql<{ n: number }>`select app.deliver_record_ready(${outbox}::uuid) as n`.execute(app)).rows[0]!.n).toBe(0);
    expect((await sql<{ source: unknown }>`select app.documental_record_reproduction_source(${outbox}::uuid) as source`.execute(app)).rows[0]!.source).toBeNull();
    expect(
      (await sql<{ result: string }>`select app.reproduce_documental_record(${outbox}::uuid, 'k', ${sha("a")}, 1, ${sha("b")}, 1, now(), true, '[]'::jsonb) as result`.execute(app)).rows[0]!
        .result,
    ).toBe("not_found");
  });
});

describe("Rabaed Admin's functions", () => {
  it("are not the app role's, whoever is set", async () => {
    expect(await failure(seer, sql`select * from app.documental_record_alerts()`)).toBe("42501");
    expect(await failure(null, sql`select * from app.documental_record_alerts()`)).toBe("42501");
    expect(await failure(seer, sql`select app.request_documental_record_reproduction(${itemId}::uuid, ${randomUUID()}::uuid)`)).toBe("42501");
  });

  it("queue nothing for an item whose record is still preparing", async () => {
    const result = await admin.query<{ result: string }>("select app.request_documental_record_reproduction($1, $2) as result", [itemId, randomUUID()]);
    expect(result.rows[0]!.result).toBe("not_found");
  });
});

// RP-670 (visibility.md RP-670-1): the Record Job Monitor is Rabaed's alone. A record job's error
// text is read by a Rabaed Engineer; no Member's session reaches it, nor the retries.
describe("scenario RP-670-1: the Record Job Monitor", () => {
  it("keeps the retries admin-only: no grant to the app role, a read for Rabaed Admin's role, no write", async () => {
    expect(await failure(seer, sql.raw("select * from record_job_retry"))).toBe("42501");
    expect(await failure(null, sql.raw("select id from record_job_retry"))).toBe("42501");
    expect(await failure(seer, sql.raw("insert into record_job_retry (id) values (gen_random_uuid())"))).toBe("42501");
    await expect(admin.query("select count(*) from record_job_retry")).resolves.toBeTruthy();
    await expect(admin.query("insert into record_job_retry (dead_outbox_id, outbox_id, admin_action_id) values ($1, $1, $1)", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
  });

  it("gives its functions to Rabaed Admin's role only, whoever is set", async () => {
    const id = randomUUID();
    for (const call of [
      sql`select * from app.record_jobs()`,
      sql`select app.retry_record_job(${id}::uuid, ${id}::uuid)`,
      sql`select * from app.documental_record_history(${itemId}::uuid)`,
      sql`select * from app.documental_record_check_runs(${itemId}::uuid)`,
    ]) {
      expect(await failure(seer, call)).toBe("42501");
      expect(await failure(null, call)).toBe("42501");
    }
    await expect(admin.query("select * from app.record_jobs()")).resolves.toBeTruthy();
    // Nothing to retry for a row that isn't a dead record job.
    expect((await admin.query<{ result: string }>("select (app.retry_record_job($1, $1)).result", [id])).rows[0]!.result).toBe("not_found");
  });

  it("shows no Member a failed job's error text: the outbox has no read for the app role", async () => {
    const secret = "the secret renderer failure RP-670-1";
    // A dead job of no item (so it shows in no list), for the time of the reads; removed after.
    const { rows } = await migrator.query<{ project_id: string; id: string }>(
      "insert into outbox (kind, project_id, payload, attempts, last_error, last_failed_at, dead_at) select 'documental_record', project_id, $2, 8, $3, now(), now() from work_item where id = $1 returning project_id, id",
      [itemId, JSON.stringify({ closed_work_item_id: randomUUID() }), secret],
    );
    try {
      const read = (query: string) => withMember(app, seer, (trx) => sql.raw(query).execute(trx)).then((r) => r.rows);
      expect(await read("select last_error, last_failed_at from outbox where last_error like '%RP-670-1'")).toEqual([]);
      expect(await read("select count(*)::int as n from outbox where kind = 'documental_record'")).toEqual([{ n: 0 }]);
      // What the Member does read of the record is its state: 'preparing' while the record waits for its checks, never the error.
      expect(await stateOf(seer)).toBe("preparing");
    } finally {
      await migrator.query("delete from outbox where id = $1", [rows[0]!.id]);
    }
  });
});

describe("app.documental_record_state", () => {
  it("shows 'preparing' to a Member who sees the item and nothing to anyone else, the worker included", async () => {
    expect(await stateOf(seer)).toBe("preparing");
    expect(await stateOf(other)).toBeNull();
    expect(await stateOf(null)).toBeNull();
    // Positive controls: the refused Member reads the state of a record on an item they see; the seer doesn't, of C2's Draft.
    expect(await stateOf(other, othersItemId)).toBe("preparing");
    expect(await stateOf(seer, othersItemId)).toBeNull();
  });
});

describe("the record changes only as its checks and a Re-produce change it", () => {
  it("moves its status forward and nothing else, and a failed one shows no record", async () => {
    // Read in the same transaction, as the Member.
    const seen = async () => {
      await migrator.query("select set_config('app.member_id', $1, true)", [seer]);
      return (await migrator.query<{ state: string | null }>("select app.documental_record_state($1) as state", [itemId])).rows[0]!.state;
    };
    await migrator.query("begin");
    try {
      await migrator.query("update documental_record set status = 'failed_checks' where id = $1", [recordId]);
      expect(await seen()).toBeNull();
      // The checks' own move cannot publish it again; only a Re-produce (its session flag, set by its function) can.
      await migrator.query("savepoint plain");
      await expect(migrator.query("update documental_record set status = 'published' where id = $1", [recordId])).rejects.toMatchObject({ code: "42501" });
      await migrator.query("rollback to savepoint plain");
      await migrator.query("select set_config('app.documental_record_reproduce', 'on', true)");
      await migrator.query("update documental_record set status = 'published' where id = $1", [recordId]);
      expect(await seen()).toBe("published");
    } finally {
      await migrator.query("rollback");
    }
  });

  it("lets a Re-produce replace the PDF's fingerprint and seal date, and exactly those", async () => {
    const replace = (set: string) => migrator.query(`update documental_record set ${set} where id = $1`, [recordId]);
    const inReproduce = async (fn: () => Promise<void>) => {
      await migrator.query("begin");
      try {
        await migrator.query("alter table documental_record disable trigger documental_record_written_once");
        await replace("status = 'published'");
        await migrator.query("alter table documental_record enable trigger documental_record_written_once");
        await migrator.query("select set_config('app.documental_record_reproduce', 'on', true)");
        await fn();
      } finally {
        await migrator.query("rollback");
      }
    };
    const refused = async (set: string) => {
      await migrator.query("savepoint refused");
      await expect(replace(set)).rejects.toMatchObject({ code: "42501" });
      await migrator.query("rollback to savepoint refused");
    };
    await inReproduce(async () => {
      await replace("sealed_at = now() + interval '1 minute', pdf_sha256 = '\\x" + sha("new").toString("hex") + "'");
      await refused("outcome = 'B'");
      await refused("verification_code = 'ZZZZ-ZZZZ'");
      await refused("status = 'failed_checks'");
      await refused("status = 'preparing'");
      await refused("language = 'ar'");
    });
    // Without the worker's function setting it, a changed fingerprint is refused.
    await migrator.query("begin");
    try {
      await migrator.query("alter table documental_record disable trigger documental_record_written_once");
      await replace("status = 'published'");
      await migrator.query("alter table documental_record enable trigger documental_record_written_once");
      await refused(`pdf_sha256 = '\\x${sha("new").toString("hex")}'`);
      await refused("sealed_at = now() + interval '1 minute'");
    } finally {
      await migrator.query("rollback");
    }
  });
});
