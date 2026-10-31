// Seam 2 for the verification of a Documental Record (RP-157, spec RP-632; ADR 0023; visibility.md,
// the Verification page row, scenario RP-23-4; migration 20270910000000_documental_record_verification.sql),
// as the app role, which the api's public route connects as with no Member set. The two definer
// functions are the only way in: the app role reads no table it couldn't before, nor the helpers they
// use, and they answer only a published record, with exactly the page's fields.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, wirAtConsultant } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let member = "";

const sha = (s: string) => createHash("sha256").update(s).digest();
const visitor = (n: number) => sha(`visitor ${n} of RP-157 seam 2`);

/** The error code `query` fails with as Member `memberId` (or with none, as the public route), or null. */
async function failure(memberId: string | null, query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    if (memberId) await withMember(app, memberId, (trx) => query.execute(trx));
    else await query.execute(app);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

interface Record_ {
  token: string;
  code: string;
  documentNumber: string;
}
const records: Record<"published" | "preparing" | "failed", Record_> = {} as never;
let faceless = "";

const byToken = (token: string) =>
  sql<{ v: Record<string, unknown> | null }>`select app.verify_documental_record_by_token(${sha(token)}) as v`.execute(app).then((r) => r.rows[0]!.v);
const byCode = (code: string, documentNumber: string, who = visitor(0), limit = 1000) =>
  sql<{ outcome: string; verification: Record<string, unknown> | null }>`
    select outcome, verification from app.verify_documental_record_by_code(${code}, ${documentNumber}, ${who}, now(), ${limit}::integer, interval '15 minutes')
  `
    .execute(app)
    .then((r) => r.rows[0]!);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // This file's own Tower (RP-995): four numbered WIRs, three given a record as the worker saves one (the migrator
  // stands in for it), one in each status, and one a record made before RP-157.
  const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RVR" });
  member = tower.c1.members.engineer;
  const numbered = async (title: string) => {
    const id = await wirAtConsultant(tower, { type: "WIR", title });
    const { rows } = await migrator.query<{ id: string; project_id: string; document_number: string }>(
      "select id, project_id, document_number from work_item where id = $1 and document_number is not null",
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const items = [await numbered("Slab pour 1"), await numbered("Slab pour 2"), await numbered("Slab pour 3")];
  const statuses = ["published", "preparing", "failed_checks"] as const;
  for (const [i, item] of items.entries()) {
    const key = `projects/${item.project_id}/work-items/${item.id}/documental-record/rp157`;
    const file = async (name: string, mime: string) =>
      (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [`${key}/${name}`, sha(name), mime]))
        .rows[0]!.id;
    const token = randomUUID();
    const code = `RP15-7SE${i}`;
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
       values ($1, $2, $3, $4, '2', 'bilingual', 'A', $5, now(), $6, $7, $8)`,
      [item.project_id, item.id, await file("record.pdf", "application/pdf"), await file("record-data.xml", "application/xml"), sha(`pdf ${i}`), sha(token), code, statuses[i]],
    );
    // Its printed face, as the worker writes it (app.save_documental_record_face, which the migrator stands in for).
    await migrator.query(
      `insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers)
       select r.id, 'en', $2, 'Printed subject', '{"en": "Printed Project"}', '{"code": "A", "name": {"en": "Approved"}}',
         '[{"name": {"en": "Printed Signer"}, "positions": [{"en": "Engineer"}], "company": {"en": "Printed Company"}}]'
       from documental_record r where r.work_item_id = $1`,
      [item.id, item.document_number],
    );
    records[(["published", "preparing", "failed"] as const)[i]!] = { token, code, documentNumber: item.document_number };
  }
  // A published record made before RP-157, with no face: answered as one that doesn't exist (no backfill).
  {
    const item = await numbered("Slab pour 4");
    const key = `projects/${item.project_id}/work-items/${item.id}/documental-record/rp157`;
    const file = async (name: string) =>
      (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, 'application/pdf') returning id", [`${key}/${name}`, sha(name)]))
        .rows[0]!.id;
    faceless = randomUUID();
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
       values ($1, $2, $3, $4, '2', 'bilingual', 'A', $5, now(), $6, 'RP15-7SE9', 'published')`,
      [item.project_id, item.id, await file("old.pdf"), await file("old.xml"), sha("old pdf"), sha(faceless)],
    );
  }
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("scenario RP-1083-4: the app role reads nothing new", () => {
  it("can't read or write the visitors' attempts, as the public route or as a Member", async () => {
    for (const who of [null, member]) {
      expect(await failure(who, sql`select * from verification_attempt`)).toBe("42501");
      expect(await failure(who, sql`insert into verification_attempt (visitor_sha256, attempted_at) values (${visitor(9)}, now())`)).toBe("42501");
      expect(await failure(who, sql`delete from verification_attempt`)).toBe("42501");
    }
  });

  it("can't write a record's face itself: only the worker, with no Member set, through its function", async () => {
    expect(await failure(member, sql`select app.save_documental_record_face(${randomUUID()}::uuid, '{}'::jsonb)`)).toBe("42501");
    const { rows } = await sql<{ saved: boolean }>`select app.save_documental_record_face(${randomUUID()}::uuid, '{}'::jsonb) as saved`.execute(app);
    expect(rows[0]!.saved).toBe(false);
  });

  it("still can't read the record, its face, its history or its signers' rows directly", async () => {
    for (const table of ["documental_record", "documental_record_face", "documental_record_reproduction", "work_item_event_signer", "documental_record_check"]) {
      expect(await failure(null, sql`select * from ${sql.table(table)}`), table).toBe("42501");
    }
  });

  it("can't run the helpers the two functions use", async () => {
    expect(await failure(null, sql`select app.documental_record_verification(${randomUUID()}::uuid)`)).toBe("42501");
  });

  it("is the only role that may run the two functions: not Rabaed Admin's, not public", async () => {
    const { rows } = await migrator.query<{ fn: string; app: boolean; admin: boolean }>(
      `select p.oid::regprocedure::text as fn, has_function_privilege('rabaed_app', p.oid, 'execute') as app,
         has_function_privilege('rabaed_admin', p.oid, 'execute') as admin
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('verify_documental_record_by_token', 'verify_documental_record_by_code')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([row.fn, row.app, row.admin]).toEqual([row.fn, true, false]);
  });
});

describe("scenario RP-1083-4: app.verify_documental_record_by_token", () => {
  it("RP-23-4: answers a published record with exactly the page's fields, with no Member set", async () => {
    const v = await byToken(records.published.token);
    expect(Object.keys(v!).sort()).toEqual(["documentNumber", "fingerprints", "outcome", "project", "sealedAt", "signers", "status", "subject"].sort());
    // Its printed face, as the worker kept it: never the live item's Subject or Project.
    expect(v).toMatchObject({
      status: "genuine",
      documentNumber: records.published.documentNumber,
      subject: "Printed subject",
      project: { en: "Printed Project" },
      signers: [{ name: { en: "Printed Signer" } }],
      fingerprints: { replaced: [] },
    });
  });

  it("answers nothing for a record being prepared, one that failed its checks, one with no face, or a made-up token", async () => {
    expect(await byToken(records.preparing.token)).toBeNull();
    expect(await byToken(records.failed.token)).toBeNull();
    expect(await byToken(faceless)).toBeNull();
    expect(await byToken(randomUUID())).toBeNull();
  });
});

describe("scenario RP-1083-4: app.verify_documental_record_by_code", () => {
  it("finds a published record by its code with its Document Number, in any case", async () => {
    const found = await byCode(records.published.code, records.published.documentNumber.toLowerCase());
    expect(found.outcome).toBe("found");
    expect(found.verification).toEqual(await byToken(records.published.token));
  });

  it("RP-23-4: is not_found for the code alone, a wrong pair, and a record not published", async () => {
    for (const [code, number] of [
      [records.published.code, ""],
      [records.published.code, records.preparing.documentNumber],
      ["ZZZZ-ZZZZ", records.published.documentNumber],
      [records.preparing.code, records.preparing.documentNumber],
      [records.failed.code, records.failed.documentNumber],
    ] as const) {
      expect(await byCode(code, number), `${code} ${number}`).toEqual({ outcome: "not_found", verification: null });
    }
  });

  it("refuses a visitor past the limit within the window, and counts nobody else's attempts", async () => {
    const who = visitor(1);
    for (let i = 0; i < 3; i++) expect((await byCode("ZZZZ-ZZZZ", "x", who, 3)).outcome).toBe("not_found");
    expect(await byCode(records.published.code, records.published.documentNumber, who, 3)).toEqual({ outcome: "too_many_attempts", verification: null });
    expect((await byCode(records.published.code, records.published.documentNumber, visitor(2), 3)).outcome).toBe("found");
  });

  it("refuses a call without a visitor or a limit", async () => {
    expect(await failure(null, sql`select * from app.verify_documental_record_by_code('a', 'b', null, now(), 3, interval '1 minute')`)).toBe("22023");
    expect(await failure(null, sql`select * from app.verify_documental_record_by_code('a', 'b', ${visitor(3)}, now(), 0, interval '1 minute')`)).toBe("22023");
  });
});
