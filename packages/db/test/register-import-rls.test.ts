// Seam 2 for the Submittal Register Import tracer (RP-637, spec RP-631; visibility.md
// RP-589-1), as the app role. C1 imports a register: only C1's Members read the import
// and its rows (a preview only its importer), never its times; C2, K1 and the Owner read
// nothing of it. Imports and their Drafts are written only through the import's functions,
// a row is never created outside its raiser's Visibility, and the `created` event names
// the import only for a Draft its confirm made.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: imports the register.
let k1: Company; // Consultant.
let c2: Company; // Another Contractor.
let ow: Company; // The Owner.
let c1Colleague = ""; // Another Member of C1 on the Project.
let c1Narrowed = ""; // A C1 engineer whose Trade Visibility is Electrical only.
let c1Participant = "";
let projectId = "";
let electrical = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
/** The SQL error code `query` fails with as `as` (null when it doesn't fail). */
const failure = (as: string | null, query: ReturnType<typeof sql>) =>
  (as === null ? app.transaction().execute((trx) => query.execute(trx)) : withMember(app, as, (trx) => query.execute(trx))).then(
    () => null,
    (error: { code?: string }) => error.code ?? "?",
  );

const headers = ["Subject", "Type", "Trade"];
const mapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 } };
const row = (rowNo: number, subject: string, type: string, trade: string) => ({ row_no: rowNo, cells: [subject, type, trade], subject, type, trade });
/** Panels (Electrical) and Pumps (Mechanical) are good for C1; the third row is bad three times. */
const rows = [row(2, "Panels", "MAR", "Electrical"), row(3, "Pumps", "SAR", "ME"), row(4, "", "XYZ", "Plumbing")];

/** `as`'s preview of `rows`, and its outcome. */
async function preview(as: string, of = rows) {
  const [r] = await call<{ outcome: string; import_id: string | null }>(
    as,
    sql`select outcome, import_id from app.preview_register_import(
      ${projectId}::uuid, 'register.xlsx', 'Register', 1, ${JSON.stringify(headers)}::jsonb, ${JSON.stringify(mapping)}::jsonb,
      ${JSON.stringify(of)}::jsonb, null, null, now())`,
  );
  return r!;
}
const confirm = (as: string, importId: string) =>
  call<{ outcome: string; rows_created: number | null }>(as, sql`select outcome, rows_created from app.confirm_register_import(${importId}::uuid, now())`).then(
    (r) => r[0]!,
  );
const importsSeen = (as: string) => call<{ id: string }>(as, sql`select id from submittal_register_import`).then((r) => r.map((x) => x.id));
const rowsSeen = (as: string, importId: string) =>
  call<{ row_no: number }>(as, sql`select row_no from submittal_register_import_row where import_id = ${importId}::uuid order by row_no`).then((r) =>
    r.map((x) => x.row_no),
  );
const results = (as: string, importId: string) =>
  call<{ row_no: number; created: boolean; work_item_id: string | null }>(as, sql`select * from app.register_import_results(${importId}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  ow = await company(engineer, "OW");
  c1Colleague = await member(c1.id, "pm");
  c1Narrowed = await member(c1.id, "narrowed");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RGI', 'contractor')`,
  );
  projectId = created!.project_id;
  c1Participant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  const participant = {
    c1: c1Participant,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
  };
  const value = async (kind: string, code: string, name: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: name, ar: name })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL", "Electrical");
  await value("trade", "ME", "Mechanical");
  await value("location", "BA", "Building A");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Colleague, ["project_manager"]],
    [c1, participant.c1, c1Narrowed, ["engineer"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [c2, participant.c2, c2.member, ["engineer"]],
    [ow, participant.ow, ow.member, ["project_manager"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      const narrowed = m === c1Narrowed && kind === "trade";
      expect(
        await outcome(
          co.ap,
          sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, ${!narrowed}, ${narrowed ? [electrical] : []}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

describe("RP-589-1: only the importing Participant reads an import", () => {
  let importId = "";
  let drafts: string[] = [];

  beforeAll(async () => {
    const previewed = await preview(c1.member);
    expect(previewed.outcome).toBe("previewed");
    importId = previewed.import_id!;
  });

  it("keeps a preview to its importer, and creates nothing", async () => {
    expect(await importsSeen(c1.member)).toContain(importId);
    expect(await rowsSeen(c1.member, importId)).toEqual([2, 3, 4]);
    expect(await importsSeen(c1Colleague)).not.toContain(importId);
    expect(await rowsSeen(c1Colleague, importId)).toEqual([]);
    expect(await results(c1Colleague, importId)).toEqual([]);
    const { rows: made } = await migrator.query("select id from work_item where import_id = $1", [importId]);
    expect(made).toEqual([]);
  });

  it("records every reason a row is bad", async () => {
    const reasons = await call<{ row_no: number; reasons: string[] }>(
      c1.member,
      sql`select row_no, reasons from submittal_register_import_row where import_id = ${importId}::uuid order by row_no`,
    );
    expect(reasons).toEqual([
      { row_no: 2, reasons: [] },
      { row_no: 3, reasons: [] },
      { row_no: 4, reasons: ["subject_missing", "type_unknown", "trade_unknown"] },
    ]);
  });

  it("on confirm, is read by every Member of C1, and by no one of C2, K1 or the Owner", async () => {
    expect(await confirm(c1.member, importId)).toEqual({ outcome: "created", rows_created: 2 });
    drafts = (await results(c1.member, importId)).flatMap((r) => (r.work_item_id ? [r.work_item_id] : []));
    expect(drafts).toHaveLength(2);
    expect(await importsSeen(c1Colleague)).toContain(importId);
    expect(await rowsSeen(c1Colleague, importId)).toEqual([2, 3, 4]);
    for (const other of [c2.member, c2.ap, k1.member, k1.ap, ow.member, ow.ap]) {
      expect(await importsSeen(other)).toEqual([]);
      expect(await rowsSeen(other, importId)).toEqual([]);
      expect(await results(other, importId)).toEqual([]);
      expect(await confirm(other, importId)).toEqual({ outcome: "not_found", rows_created: null });
      const seen = await call<{ id: string }>(other, sql`select id from work_item where id = any (${drafts}::uuid[])`);
      expect(seen).toEqual([]);
    }
  });

  it("never gives the app role an import's times, its confirm's working column, a row's Draft or a Draft's import", async () => {
    for (const column of ["created_at", "confirmed_at", "confirm_txid"]) {
      expect(await failure(c1.member, sql.raw(`select ${column} from submittal_register_import`))).toBe("42501");
    }
    expect(await failure(c1.member, sql`select work_item_id from submittal_register_import_row`)).toBe("42501");
    expect(await failure(c1.member, sql`select import_id from work_item`)).toBe("42501");
  });

  it("writes imports, rows and their Drafts only through the import's functions", async () => {
    expect(
      await failure(
        c1.member,
        sql`insert into submittal_register_import (project_id, participant_id, run_by_member_id, file_name, sheet, header_row, headers, mapping, rows_total, rows_rejected)
            values (${projectId}::uuid, ${c1Participant}::uuid, ${c1.member}::uuid, 'x.csv', 'x', 1, '[]', '{}', 0, 0)`,
      ),
    ).toBe("42501");
    expect(await failure(c1.member, sql`update submittal_register_import set status = 'created'`)).toBe("42501");
    expect(await failure(c1.member, sql`delete from submittal_register_import_row`)).toBe("42501");
    expect(await failure(c1.member, sql`update work_item set import_id = null`)).toBe("42501");
  });

  it("names the import in each Draft's created event, raised by the importer", async () => {
    const { rows: events } = await migrator.query(
      "select e.work_item_id, e.actor_member_id, e.payload ->> 'import_id' as import_id from work_item_event e where e.work_item_id = any ($1) and e.type = 'created'",
      [drafts],
    );
    expect(events).toHaveLength(2);
    for (const e of events) expect(e).toMatchObject({ actor_member_id: c1.member, import_id: importId });
    const { rows: items } = await migrator.query("select import_id, document_number, created_by_member_id from work_item where id = any ($1)", [drafts]);
    for (const i of items) expect(i).toEqual({ import_id: importId, document_number: null, created_by_member_id: c1.member });
  });

  it("never lets another Draft claim an import: a Draft made by hand beside a preview names none", async () => {
    const pending = await preview(c1.member);
    expect(pending.outcome).toBe("previewed");
    const [made] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'By hand', app.new_item_form_version(${projectId}::uuid, 'MAR'), '{}'::jsonb, ${electrical}::uuid, null, now())`,
    );
    expect(made!.outcome).toBe("created");
    const { rows: events } = await migrator.query("select payload from work_item_event where work_item_id = $1 and type = 'created'", [made!.work_item_id]);
    expect(events[0].payload).not.toHaveProperty("import_id");
  });
});

describe("A created row's Draft is given only to a reader who sees it", () => {
  it("names the Electrical Draft to a C1 colleague narrowed to Electrical, and not the Mechanical one, though both were created", async () => {
    const imported = (await preview(c1.member)).import_id!;
    expect((await confirm(c1.member, imported)).outcome).toBe("created");
    const all = await results(c1.member, imported);
    const narrowed = await results(c1Narrowed, imported);
    expect(narrowed.map((r) => [r.row_no, r.created, r.work_item_id !== null])).toEqual([
      [2, true, true],
      [3, true, false],
      [4, false, false],
    ]);
    expect(narrowed[0]!.work_item_id).toBe(all[0]!.work_item_id);
    expect(all[1]!.work_item_id).not.toBeNull();
  });
});

describe("A Type the importer may not raise", () => {
  it("makes its rows bad, beside the reasons of the rest", async () => {
    // A Submittals Type with no Workflow: known by its code, raisable by nobody.
    await migrator.query(`
      with d as (insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "No Workflow", "ar": "No Workflow"}'::jsonb) returning id)
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select 'rabaed', 'submittals', 'RGX', '{"en": "Register test", "ar": "Register test"}'::jsonb, d.id, 'review_code',
        (select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR')
      from d`);
    const previewed = await preview(c1.member, [row(2, "Panels", "RGX", "Electrical"), row(3, "", "RGX", "Nope")]);
    const reasons = await call<{ row_no: number; reasons: string[] }>(
      c1.member,
      sql`select row_no, reasons from submittal_register_import_row where import_id = ${previewed.import_id}::uuid order by row_no`,
    );
    expect(reasons).toEqual([
      { row_no: 2, reasons: ["type_not_allowed"] },
      { row_no: 3, reasons: ["subject_missing", "type_not_allowed", "trade_unknown"] },
    ]);
  });
});

describe("A row is never created outside its raiser's Visibility", () => {
  it("makes the row bad at the preview", async () => {
    const previewed = await preview(c1Narrowed);
    const reasons = await call<{ row_no: number; reasons: string[] }>(
      c1Narrowed,
      sql`select row_no, reasons from submittal_register_import_row where import_id = ${previewed.import_id}::uuid order by row_no`,
    );
    expect(reasons.find((r) => r.row_no === 3)!.reasons).toEqual(["trade_outside_visibility"]);
  });

  it("refuses the whole confirm when the importer was narrowed since, creating nothing", async () => {
    const previewed = await preview(c1Colleague);
    await outcome(c1.ap, sql`select app.set_member_visibility(${c1Participant}::uuid, ${c1Colleague}::uuid, 'trade', false, ${[electrical]}::uuid[], now()) as outcome`);
    expect(await confirm(c1Colleague, previewed.import_id!)).toEqual({ outcome: "preview_outdated", rows_created: null });
    const { rows: made } = await migrator.query("select id from work_item where import_id = $1", [previewed.import_id]);
    expect(made).toEqual([]);
    const { rows: state } = await migrator.query("select status, confirm_txid from submittal_register_import where id = $1", [previewed.import_id]);
    expect(state).toEqual([{ status: "previewed", confirm_txid: null }]);
  });

  it("refuses a preview to a Participant that may raise no Submittals Type", async () => {
    expect((await preview(k1.member)).outcome).toBe("forbidden");
    expect((await preview(ow.member)).outcome).toBe("forbidden");
  });
});

describe("The clean-up of previews never confirmed", () => {
  it("deletes previews older than 7 days with their rows, keeps confirmed imports, and refuses a Member's session", async () => {
    const stale = (await preview(c1.member)).import_id!;
    const kept = (await preview(c1.member)).import_id!;
    expect((await confirm(c1.member, kept)).outcome).toBe("created");
    await migrator.query("update submittal_register_import set created_at = now() - interval '8 days' where id = any ($1)", [[stale, kept]]);
    // The importer can no longer confirm it either.
    expect(await confirm(c1.member, stale)).toEqual({ outcome: "not_found", rows_created: null });
    expect(await failure(c1.member, sql`select app.clean_previewed_register_imports(now())`)).toBe("42501");
    const [cleaned] = await app
      .transaction()
      .execute((trx) => sql<{ n: number }>`select app.clean_previewed_register_imports(now()) as n`.execute(trx).then((r) => r.rows));
    expect(cleaned!.n).toBeGreaterThanOrEqual(1);
    const { rows: left } = await migrator.query("select id from submittal_register_import where id = any ($1)", [[stale, kept]]);
    expect(left).toEqual([{ id: kept }]);
    const { rows: orphans } = await migrator.query("select 1 from submittal_register_import_row where import_id = $1", [stale]);
    expect(orphans).toEqual([]);
  });
});
