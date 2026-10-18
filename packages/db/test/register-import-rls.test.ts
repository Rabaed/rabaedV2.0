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
import { drainOutbox, joinProject, testDatabaseUrls } from "../test-support/index.ts";

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
let mechanical = "";
let buildingA = "";
let buildingB = "";

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
type Row = { row_no: number; cells: string[]; subject: string; type: string; trade: string } & Record<string, unknown>;
const row = (rowNo: number, subject: string, type: string, trade: string, more: Record<string, unknown> = {}): Row => ({
  row_no: rowNo,
  cells: [subject, type, trade],
  subject,
  type,
  trade,
  ...more,
});
/** Panels (Electrical) and Pumps (Mechanical) are good for C1; the third row is bad three times. */
const rows = [row(2, "Panels", "MAR", "Electrical"), row(3, "Pumps", "SAR", "ME"), row(4, "", "XYZ", "Plumbing")];

/** What the api matches a row's Type and Trade cells to (RP-639, apps/api register-import/matching.ts), by their text. */
const matched: { types: string[]; trades: Record<string, string> } = { types: ["MAR", "SAR", "DAR"], trades: {} };
const asMatched = (r: Row) => ({
  type_code: matched.types.includes(r.type) ? r.type : null,
  trade_id: matched.trades[r.trade] ?? null,
  ...r,
});

/** `as`'s preview of `rows`, and its outcome. */
async function preview(as: string, of: Row[] = rows) {
  const [r] = await call<{ outcome: string; import_id: string | null }>(
    as,
    sql`select outcome, import_id from app.preview_register_import(
      ${projectId}::uuid, 'register.xlsx', 'Register', 1, ${JSON.stringify(headers)}::jsonb, ${JSON.stringify(mapping)}::jsonb,
      ${JSON.stringify(of.map(asMatched))}::jsonb, null, null, now())`,
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
  mechanical = await value("trade", "ME", "Mechanical");
  buildingA = await value("location", "BA", "Building A");
  buildingB = await value("location", "BB", "Building B");
  matched.trades = { Electrical: electrical, ME: mechanical };
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
    // RP-639: a row's checked answers and their Form Version are the confirm's only.
    for (const column of ["answers", "form_version_id"]) {
      expect(await failure(c1.member, sql.raw(`select ${column} from submittal_register_import_row`))).toBe("42501");
    }
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
    matched.types.push("RGX");
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

// RP-639: the api hands the preview what each row matched; the database checks every id
// again, as app.create_work_item would, and keeps one Paper ref per Participant.
describe("Matched values, checked again by the database (RP-639)", () => {
  let lighting = "";
  let pumps = "";

  beforeAll(async () => {
    const scope = async (trade: string, name: string) =>
      (await call<{ scope_id: string }>(c1.ap, sql`select scope_id from app.add_scope(${projectId}::uuid, ${trade}::uuid, null, ${JSON.stringify({ en: name, ar: name })}::jsonb)`))[0]!
        .scope_id;
    lighting = await scope(electrical, "Lighting");
    pumps = await scope(mechanical, "Pumps");
  });

  const reasonsOf = (as: string, importId: string) =>
    call<{ row_no: number; reasons: string[] }>(
      as,
      sql`select row_no, reasons from submittal_register_import_row where import_id = ${importId}::uuid order by row_no`,
    ).then((r) => Object.fromEntries(r.map((x) => [x.row_no, x.reasons])));

  it("refuses a Scope not under the row's Trade, a Location not the Project's, and a Type outside the Submittals, whatever the api matched", async () => {
    const otherProject = (
      await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Other", "ar": "Other"}'::jsonb, 'RGO', 'contractor')`)
    )[0]!.project_id;
    const elsewhere = (
      await call<{ value_id: string }>(c1.ap, sql`select value_id from app.add_dimension_value(${otherProject}::uuid, 'location', null, 'XX', '{"en": "X", "ar": "X"}'::jsonb)`)
    )[0]!.value_id;
    const previewed = await preview(c1.member, [
      row(2, "Lit", "MAR", "Electrical", { scopes: "Lighting", scope_ids: [lighting], location: "Building A", location_id: buildingA }),
      row(3, "Pumps on Electrical", "MAR", "Electrical", { scopes: "Pumps", scope_ids: [pumps] }),
      row(4, "Elsewhere", "MAR", "Electrical", { location: "X", location_id: elsewhere }),
      row(5, "A Snag", "SNG", "Electrical", { type_code: "SNG" }),
      row(6, "Bad field", "MAR", "Electrical", { invalid_fields: ["manufacturer"], scope_reason: "scope_unknown" }),
    ]);
    expect(await reasonsOf(c1.member, previewed.import_id!)).toEqual({
      2: [],
      3: ["scope_not_under_trade"],
      4: ["location_unknown"],
      5: ["type_unknown"],
      6: ["scope_unknown", "field_invalid"],
    });
  });

  it("RP-589-4: refuses a Location outside the importer's Visibility", async () => {
    await outcome(c1.ap, sql`select app.set_member_visibility(${c1Participant}::uuid, ${c1Narrowed}::uuid, 'location', false, ${[buildingB]}::uuid[], now()) as outcome`);
    const previewed = await preview(c1Narrowed, [row(2, "Lit", "MAR", "Electrical", { location: "Building A", location_id: buildingA })]);
    expect(await reasonsOf(c1Narrowed, previewed.import_id!)).toEqual({ 2: ["location_outside_visibility"] });
  });

  describe("The Paper ref", () => {
    let draft = "";

    it("is refused when repeated in the register, whatever its case, and set on the Draft at confirm", async () => {
      const previewed = await preview(c1.member, [
        row(2, "First", "MAR", "Electrical", { paper_ref: "PR-1" }),
        row(3, "Second", "MAR", "Electrical", { paper_ref: "pr-1" }),
        row(4, "Third", "MAR", "Electrical", { paper_ref: "PR-2", scope_ids: [lighting], location_id: buildingA, location: "BA" }),
      ]);
      expect(await reasonsOf(c1.member, previewed.import_id!)).toEqual({ 2: ["paper_ref_repeated"], 3: ["paper_ref_repeated"], 4: [] });
      expect(await confirm(c1.member, previewed.import_id!)).toEqual({ outcome: "created", rows_created: 1 });
      draft = (await results(c1.member, previewed.import_id!)).find((r) => r.row_no === 4)!.work_item_id!;
      const [made] = await call<{ paper_ref: string }>(c1.member, sql`select paper_ref from work_item where id = ${draft}::uuid`);
      expect(made).toEqual({ paper_ref: "PR-2" });
      const { rows: built } = await migrator.query(
        "select (select array_agg(scope_id) from work_item_scope where work_item_id = $1) as scopes, (select dimension_value_id from work_item_dimension_value where work_item_id = $1 and dimension_value_id = $2) as location",
        [draft, buildingA],
      );
      expect(built).toEqual([{ scopes: [lighting], location: buildingA }]);
    });

    it("is refused when another item of the Participant holds it, and taken since the preview refuses the confirm", async () => {
      expect(await reasonsOf(c1.member, (await preview(c1.member, [row(2, "Again", "MAR", "Electrical", { paper_ref: "pr-2" })])).import_id!)).toEqual({
        2: ["paper_ref_taken"],
      });
      const pending = (await preview(c1.member, [row(2, "Later", "MAR", "Electrical", { paper_ref: "PR-3" })])).import_id!;
      expect(await outcome(c1.member, sql`select app.set_work_item_paper_ref(${draft}::uuid, 'pr-3', now()) as outcome`)).toBe("saved");
      expect(await confirm(c1.member, pending)).toEqual({ outcome: "preview_outdated", rows_created: null });
    });

    it("RP-589-4: is written only through the functions, read by whoever sees the item, set only by who may edit the Draft", async () => {
      expect(await failure(c1.member, sql`update work_item set paper_ref = 'X' where id = ${draft}::uuid`)).toBe("42501");
      expect(await outcome(c1Colleague, sql`select app.set_work_item_paper_ref(${draft}::uuid, 'PR-9', now()) as outcome`)).toBe("not_editable");
      for (const other of [k1.member, c2.member, ow.member]) {
        expect(await outcome(other, sql`select app.set_work_item_paper_ref(${draft}::uuid, 'PR-9', now()) as outcome`)).toBe("not_found");
        expect(await call(other, sql<{ paper_ref: string }>`select paper_ref from work_item where id = ${draft}::uuid`)).toEqual([]);
      }
      expect(await outcome(c1.member, sql`select app.set_work_item_paper_ref(${draft}::uuid, ${"P".repeat(101)}, now()) as outcome`)).toBe("paper_ref_too_long");
      // The unique index keeps one per Participant even past the function's own check.
      const { rows: others } = await migrator.query(
        "select id from work_item where project_id = $1 and raised_by_participant_id = $2 and id <> $3 and discarded_at is null limit 1",
        [projectId, c1Participant, draft],
      );
      await expect(migrator.query("update work_item set paper_ref = 'PR-3' where id = $1", [others[0].id])).rejects.toMatchObject({ code: "23505" });
    });
  });
});

// RP-640: a row's raiser is the Member it is assigned to (picked for a group of rows, or
// by email in an "Assign to" column), an active Member of the importing Participant on
// the Project who may raise its Type and covers its values; the Draft is their own, and
// its `created` event names the importer and the import.
describe("RP-589-2: rows assigned to a Member, who raises their Drafts", () => {
  let importer = ""; // C1's PM, seeing all of the Project: imports and assigns.
  let noCreate = ""; // A C1 Member on the Project with no Position: holds no Create.
  let removed = ""; // A C1 Member taken off the Project.

  const reasonsOf = (as: string, importId: string) =>
    call<{ row_no: number; reasons: string[] }>(
      as,
      sql`select row_no, reasons from submittal_register_import_row where import_id = ${importId}::uuid order by row_no`,
    ).then((r) => Object.fromEntries(r.map((x) => [x.row_no, x.reasons])));
  const assigned = (to: string | null, text = "") => ({ assignee: text, assignee_member_id: to });

  beforeAll(async () => {
    importer = await member(c1.id, "importer");
    noCreate = await member(c1.id, "no-create");
    removed = await member(c1.id, "removed");
    for (const m of [importer, noCreate, removed]) {
      await call(c1.ap, sql<{ outcome: string }>`select app.add_project_member(${c1Participant}::uuid, ${m}::uuid, now())`);
      for (const kind of ["trade", "location"]) {
        await outcome(c1.ap, sql`select app.set_member_visibility(${c1Participant}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`);
      }
    }
    await outcome(c1.ap, sql`select app.set_project_member_positions(${c1Participant}::uuid, ${importer}::uuid, ${["project_manager"]}::text[]) as outcome`);
    await outcome(c1.ap, sql`select app.set_project_member_positions(${c1Participant}::uuid, ${removed}::uuid, ${["engineer"]}::text[]) as outcome`);
    await call(c1.ap, sql<{ outcome: string }>`select app.remove_project_member(${c1Participant}::uuid, ${removed}::uuid, now()) as outcome`);
    // A Submittals Type whose Draft Step its raiser holds with the Create Function Permission
    // (the Snag's Workflow): a Member with no Position may not raise it.
    await migrator.query(`
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select 'rabaed', 'submittals', 'RGC', '{"en": "Register create", "ar": "Register create"}'::jsonb,
        (select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'SNG'), 'review_code',
        (select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR')`);
    matched.types.push("RGC");
  });

  it("refuses a Mechanical row assigned to an engineer narrowed to Electrical, and keeps the Electrical one", async () => {
    const previewed = await preview(importer, [
      row(2, "Panels", "MAR", "Electrical", assigned(c1Narrowed)),
      row(3, "Pumps", "SAR", "ME", assigned(c1Narrowed)),
    ]);
    expect(await reasonsOf(importer, previewed.import_id!)).toEqual({ 2: [], 3: ["assignee_outside_visibility"] });
  });

  it("refuses an assignee who isn't an active Member of the importing Participant on the Project, whoever they are", async () => {
    const previewed = await preview(importer, [
      row(2, "K1's", "MAR", "Electrical", assigned(k1.member)),
      row(3, "C2's", "MAR", "Electrical", assigned(c2.member)),
      row(4, "Taken off", "MAR", "Electrical", assigned(removed)),
      row(5, "Made up", "MAR", "Electrical", assigned(randomUUID())),
      row(6, "An email nobody has", "MAR", "Electrical", assigned(null, "nobody@rabaed.test")),
    ]);
    expect(await reasonsOf(importer, previewed.import_id!)).toEqual({
      2: ["assignee_unknown"],
      3: ["assignee_unknown"],
      4: ["assignee_unknown"],
      5: ["assignee_unknown"],
      6: ["assignee_unknown"],
    });
  });

  it("refuses an assignee who may not raise the row's Type, while the importer may", async () => {
    const previewed = await preview(importer, [
      row(2, "Theirs to raise", "MAR", "Electrical", assigned(noCreate)),
      row(3, "Not theirs", "RGC", "Electrical", assigned(noCreate)),
      row(4, "The importer's", "RGC", "Electrical"),
    ]);
    expect(await reasonsOf(importer, previewed.import_id!)).toEqual({ 2: [], 3: ["assignee_cannot_create"], 4: [] });
  });

  describe("on confirm", () => {
    let importId = "";
    let drafts: { row_no: number; work_item_id: string | null }[] = [];

    beforeAll(async () => {
      importId = (
        await preview(importer, [
          row(2, "Panels for the engineer", "MAR", "Electrical", assigned(c1Narrowed)),
          row(3, "Pumps for the engineer", "SAR", "ME", assigned(c1Narrowed)),
          row(4, "Kept by the importer", "SAR", "ME"),
          row(5, "Assigned to the importer", "MAR", "Electrical", assigned(importer)),
        ])
      ).import_id!;
      expect(await confirm(importer, importId)).toEqual({ outcome: "created", rows_created: 3 });
      drafts = await results(importer, importId);
    });

    it("makes the assignee the Draft's raiser and holder, and nothing outside their Visibility", async () => {
      const ids = drafts.map((d) => d.work_item_id);
      expect(drafts.map((d) => [d.row_no, d.work_item_id !== null])).toEqual([
        [2, true],
        [3, false],
        [4, true],
        [5, true],
      ]);
      const { rows } = await migrator.query(
        `select w.title, w.created_by_member_id as raiser, w.raised_by_participant_id as participant, a.assignee_member_id as holder, a.status
         from work_item w join step_assignment a on a.work_item_id = w.id
         where w.id = any ($1) order by w.title`,
        [ids.filter((id) => id !== null)],
      );
      expect(rows).toEqual([
        { title: "Assigned to the importer", raiser: importer, participant: c1Participant, holder: importer, status: "picked_up" },
        { title: "Kept by the importer", raiser: importer, participant: c1Participant, holder: importer, status: "picked_up" },
        { title: "Panels for the engineer", raiser: c1Narrowed, participant: c1Participant, holder: c1Narrowed, status: "picked_up" },
      ]);
      const { rows: outside } = await migrator.query(
        "select w.id from work_item w where w.import_id = $1 and w.created_by_member_id = $2 and w.title like 'Pumps%'",
        [importId, c1Narrowed],
      );
      expect(outside).toEqual([]);
    });

    it("names the importer as the actor of the assignee's Draft's `created` event, with the import", async () => {
      const panels = drafts.find((d) => d.row_no === 2)!.work_item_id!;
      const { rows } = await migrator.query(
        "select actor_member_id, actor_participant_id, payload ->> 'import_id' as import_id from work_item_event where work_item_id = $1 and type = 'created'",
        [panels],
      );
      expect(rows).toEqual([{ actor_member_id: importer, actor_participant_id: c1Participant, import_id: importId }]);
    });

    it("tells the assignee, and nobody else, how many Drafts were imported for them", async () => {
      await drainOutbox(app);
      const panels = drafts.find((d) => d.row_no === 2)!.work_item_id!;
      const kinds = (as: string) =>
        call<{ kind: string; work_item_id: string }>(as, sql`select kind, work_item_id from notification where kind = 'drafts_imported'`);
      expect(await kinds(c1Narrowed)).toEqual([{ kind: "drafts_imported", work_item_id: panels }]);
      for (const other of [importer, c1.member, k1.member, c2.member, ow.member]) expect(await kinds(other)).toEqual([]);
      const count = (as: string) => call<{ n: number | null }>(as, sql`select app.drafts_imported_count(${panels}::uuid) as n`).then((r) => r[0]!.n);
      expect(await count(c1Narrowed)).toBe(1);
      for (const other of [importer, k1.member, c2.member]) expect(await count(other)).toBeNull();
      expect(await failure(c1Narrowed, sql`select app.deliver_drafts_imported(${randomUUID()}::uuid)`)).toBe("42501");
    });

    it("lets the assignee read and edit their Draft as their own", async () => {
      const panels = drafts.find((d) => d.row_no === 2)!.work_item_id!;
      expect(await call(c1Narrowed, sql<{ id: string }>`select id from work_item where id = ${panels}::uuid`)).toEqual([{ id: panels }]);
      expect(await outcome(c1Narrowed, sql`select app.set_work_item_paper_ref(${panels}::uuid, 'RP-640-1', now()) as outcome`)).toBe("saved");
    });
  });

  it("refuses the whole confirm when the assignee was narrowed since the preview, creating nothing", async () => {
    const previewed = await preview(importer, [row(2, "Lighting for the colleague", "MAR", "Electrical", assigned(noCreate)), row(3, "Pumps", "SAR", "ME", assigned(noCreate))]);
    expect(await reasonsOf(importer, previewed.import_id!)).toEqual({ 2: [], 3: [] });
    await outcome(c1.ap, sql`select app.set_member_visibility(${c1Participant}::uuid, ${noCreate}::uuid, 'trade', false, ${[electrical]}::uuid[], now()) as outcome`);
    expect(await confirm(importer, previewed.import_id!)).toEqual({ outcome: "preview_outdated", rows_created: null });
    const { rows: made } = await migrator.query("select id from work_item where import_id = $1", [previewed.import_id]);
    expect(made).toEqual([]);
  });
});
