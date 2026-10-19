// Seam 2 for the Documental Record's checks, "record ready" and Re-produce (RP-155, spec
// RP-632; ADR 0023; migration 20270716000000_record_checks.sql), as the app role: what the
// checks found and the history of replaced PDFs are admin-only, the worker's functions refuse
// a Member, Rabaed Admin's refuse the app role, and a record changes only as its checks and
// a Re-produce change it.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let admin: pg.Client;
let app: Db;
let itemId = "";
let recordId = "";
let seer = "";
let other = "";

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

const stateOf = (memberId: string | null) =>
  (memberId
    ? withMember(app, memberId, (trx) => sql<{ state: string | null }>`select app.documental_record_state(${itemId}::uuid) as state`.execute(trx))
    : sql<{ state: string | null }>`select app.documental_record_state(${itemId}::uuid) as state`.execute(app)
  ).then((r) => r.rows[0]!.state);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  app = createDb(urls.app, { max: 2 });
  // A Submitted demo item no other test of the record takes (the last by id), one Member who sees it and one who doesn't.
  const { rows: items } = await migrator.query<{ id: string; project_id: string }>(
    "select id, project_id from work_item where submitted_at is not null and discarded_at is null and id not in (select work_item_id from documental_record) order by id desc limit 1",
  );
  itemId = items[0]!.id;
  const { rows: members } = await migrator.query<{ id: string }>("select id from member where status = 'active' order by id");
  for (const { id } of members) {
    const sees = await withMember(app, id, (trx) => sql<{ sees: boolean }>`select app.sees_work_item(${itemId}::uuid) as sees`.execute(trx)).then((r) => r.rows[0]!.sees);
    if (sees && !seer) seer = id;
    if (!sees && !other) other = id;
    if (seer && other) break;
  }
  expect(seer && other).toBeTruthy();
  const key = `projects/${items[0]!.project_id}/work-items/${itemId}/documental-record/record.pdf`;
  const file = async (k: string, mime: string) =>
    (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime])).rows[0]!.id;
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  recordId = (
    await migrator.query<{ id: string }>(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
       values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, 'ABCD-EF56', 'preparing') returning id`,
      [items[0]!.project_id, itemId, pdf, data, sha("pdf"), sha(randomUUID())],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await Promise.all([migrator.end(), admin.end(), app.destroy()]);
});

describe("what the checks found and the replaced PDFs", () => {
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

describe("app.documental_record_state", () => {
  it("shows 'preparing' to a Member who sees the item and nothing to anyone else, the worker included", async () => {
    expect(await stateOf(seer)).toBe("preparing");
    expect(await stateOf(other)).toBeNull();
    expect(await stateOf(null)).toBeNull();
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
