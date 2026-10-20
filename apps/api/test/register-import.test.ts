// Seam 1: the Submittal Register Import tracer (RP-637, spec RP-631; visibility.md
// RP-589-1). A Member of C1 uploads a register (.xlsx or .csv), picks the sheet and
// its header row, maps Subject, Type and Trade (from columns, or one Type and one
// Trade for the file), previews every row with every reason a bad one is bad, and
// confirms: a Draft for every good row, raised by them, and none for the bad. Only
// C1's Members read the import; C2, K1 and the Owner read nothing of it.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type {
  RegisterImport,
  RegisterImportFields,
  RegisterImportMapping,
  RegisterSheet,
  RegisterValues,
  WorkItemDetail,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildForeignProject, type ForeignProject } from "./support/foreign-project.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, projectMember, submitted, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
// Only to give a Project its own DAR Form (RP-639), as a Company's Library would.
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const fixture = (name: string) => ({
  fileName: name,
  content: readFileSync(new URL(`./fixtures/registers/${name}`, import.meta.url)).toString("base64"),
});
const xlsx = fixture("import-register.xlsx");
const csv = fixture("import-register.csv");

/** The .xlsx's Register sheet: Description is the Subject, Type the Type, Discipline the Trade. */
const byColumns: RegisterImportMapping = { subject: { column: 1 }, type: { column: 2 }, trade: { column: 3 } };
const register = { file: xlsx, sheet: "Register", headerRow: 3, mapping: byColumns };

let tower: Tower;
let c1: Company;
let k1: Company;
let c2Engineer: Caller;
let k1Engineer: Caller;
let ownerPm: Caller;
/** A C1 engineer whose Trade Visibility is Electrical only. */
let electricalOnly: Caller;

const read = (by: Caller, body: object, projectId = tower.projectId) => by.post(`/v1/projects/${projectId}/register-imports/read`, body);
const tryPreview = (by: Caller, body: object, projectId = tower.projectId) => by.post(`/v1/projects/${projectId}/register-imports`, body);
const preview = async (by: Caller, body: object): Promise<RegisterImport> => (await ok(tryPreview(by, body), 201)).json();
const confirm = (by: Caller, importId: string) => by.post(`/v1/register-imports/${importId}/confirm`, {});
const getImport = (by: Caller, importId: string) => by.get(`/v1/register-imports/${importId}`);
const listImports = async (by: Caller) => (await ok(by.get(`/v1/projects/${tower.projectId}/register-imports`), 200)).json().imports;
/** The ids of the Project's Submittals `by` lists. */
const listed = async (by: Caller): Promise<string[]> =>
  (await ok(by.get(`/v1/projects/${tower.projectId}/modules/submittals/work-items?pageSize=50`), 200)).json().items.map((i: { id: string }) => i.id);
const reasonsByRow = (preview: RegisterImport) => Object.fromEntries(preview.rows.map((r) => [r.rowNo, r.reasons]));

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "IMP");
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { projectRole: { baseRole: string } }) => p.projectRole.baseRole === "consultant").id;
  const c2 = await api.authorizedPerson();
  const owner = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  const ownerParticipantId = await api.addParticipant(c1.caller, tower.projectId, owner.company, "owner");
  for (const p of [c2ParticipantId, ownerParticipantId]) {
    await ok(c1.caller.request("PUT", `/v1/participants/${p}/visibility`, { trade: all, location: all }));
  }
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  ownerPm = await projectMember(api, owner, ownerParticipantId, ["project_manager"]);
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  electricalOnly = await projectMember(api, c1, tower.c1ParticipantId, ["engineer"], { trade: only(tower.electrical) });
});

describe("Reading a register", () => {
  it("lists the sheets, then reads the chosen sheet's top rows and its columns from the chosen header row", async () => {
    const first: RegisterSheet = (await ok(read(tower.c1Engineer, { file: xlsx }), 200)).json();
    expect(first.sheets).toEqual([
      { name: "Notes", rows: 1 },
      { name: "Register", rows: 8 },
    ]);
    expect(first.sheet).toBe("Notes");

    const chosen: RegisterSheet = (await ok(read(tower.c1Engineer, { file: xlsx, sheet: "Register", headerRow: 3 }), 200)).json();
    expect(chosen).toMatchObject({
      sheet: "Register",
      headerRow: 3,
      headers: ["No.", "Description", "Type", "Discipline", "Remarks"],
      examples: ["1", "Lighting fixtures, Floor 1", "MAR", "Electrical", "Long lead"],
      dataRows: 6,
    });
    // The rows above the header too, empty ones included, to pick the header row from.
    expect(chosen.top.map((r) => r.rowNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chosen.top[0]!.cells).toEqual(["C1 Contracting: Submittal Register"]);
    expect(chosen.top[1]!.cells).toEqual([]);
  });

  it("suggests a field for each column from its heading, with how alike they are, and none for the rest (RP-639)", async () => {
    const chosen: RegisterSheet = (await ok(read(tower.c1Engineer, { file: xlsx, sheet: "Register", headerRow: 3 }), 200)).json();
    expect(chosen.suggestions.map((s) => s?.field ?? null)).toEqual([null, "subject", "type", "trade", null]);
    for (const s of chosen.suggestions.filter((x) => x !== null)) expect(s.score).toBeGreaterThanOrEqual(60);
  });

  it("reads a .csv as one sheet named after the file", async () => {
    const sheet: RegisterSheet = (await ok(read(tower.c1Engineer, { file: csv }), 200)).json();
    expect(sheet).toMatchObject({ sheets: [{ name: "import-register", rows: 3 }], headers: ["Subject", "Notes"], dataRows: 2 });
  });

  it("refuses a file it can't read, and a header row the sheet has empty, by the reader's reason", async () => {
    const text = { fileName: "register.txt", content: Buffer.from("Subject\nPanels\n").toString("base64") };
    expect((await read(tower.c1Engineer, { file: text })).json()).toEqual({ error: "unsupported_type" });
    const empty = await read(tower.c1Engineer, { file: xlsx, sheet: "Register", headerRow: 2 });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ error: "empty_header_row" });
    expect((await read(tower.c1Engineer, { file: xlsx, sheet: "Missing" })).json()).toEqual({ error: "sheet_not_found" });
  });

  it("is refused to a Member who may raise no Submittals Type (403), and is a 404 off the Member's Projects", async () => {
    const res = await read(tower.k1Manager, { file: xlsx });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 403, body: { error: "forbidden" } });
    const stranger = await api.projectCreator();
    const elsewhere = (await api.createProject(stranger.caller)).id;
    await expectHidden(read(tower.c1Engineer, { file: xlsx }, elsewhere));
    await expectHidden(read(tower.c1Engineer, { file: xlsx }, randomUUID()));
  });
});

describe("Previewing and confirming an import", () => {
  let before: string[];
  let previewed: RegisterImport;

  beforeAll(async () => {
    before = await listed(tower.c1Engineer);
    previewed = await preview(tower.c1Engineer, register);
  });

  it("checks every row, listing every reason a bad row is bad, not only the first, with the counts", () => {
    expect(previewed).toMatchObject({ fileName: "import-register.xlsx", sheet: "Register", headerRow: 3, status: "previewed" });
    expect(previewed).toMatchObject({ rowsTotal: 6, rowsRejected: 3, rowsCreated: null, mapping: byColumns });
    expect(reasonsByRow(previewed)).toEqual({
      4: [],
      5: [],
      7: ["subject_missing", "type_unknown", "trade_unknown"],
      8: [],
      9: ["type_missing", "trade_missing"],
      10: ["subject_too_long"],
    });
    const row8 = previewed.rows.find((r) => r.rowNo === 8)!;
    // Kept exactly as written, Arabic too; the Trade matched by its code.
    expect(row8.subject).toBe("لوحات التوزيع");
    expect(row8.type.match?.code).toBe("DAR");
    expect(row8.trade).toMatchObject({ text: "EL", match: { id: tower.electrical, code: "EL" } });
    expect(row8.cells).toEqual(["4", "لوحات التوزيع", "DAR", "EL", ""]);
  });

  it("creates nothing before confirm: no Draft listed, no import on the Imports page, the preview hidden from colleagues", async () => {
    expect(await listed(tower.c1Engineer)).toEqual(before);
    expect(await listImports(tower.c1Engineer)).toEqual([]);
    await expectHidden(getImport(tower.c1Pm, previewed.id));
    await expectHidden(confirm(tower.c1Pm, previewed.id));
  });

  it("previews again when the mapping changes: a mapping mistake is cheap", async () => {
    const wrong = await preview(tower.c1Engineer, { ...register, mapping: { ...byColumns, type: { column: 3 } } });
    expect(wrong.id).not.toBe(previewed.id);
    expect(wrong.rows.filter((r) => r.reasons.includes("type_unknown")).map((r) => r.rowNo)).toEqual([4, 5, 7, 8, 10]);
  });

  it("refuses a mapping to a column the header row doesn't have", async () => {
    const res = await tryPreview(tower.c1Engineer, { ...register, mapping: { ...byColumns, subject: { column: 9 } } });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: { error: "column_not_found" } });
  });

  describe("on confirm", () => {
    let record: RegisterImport;
    let drafts: WorkItemDetail[];

    beforeAll(async () => {
      expect((await ok(confirm(tower.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 3 });
      record = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
      drafts = await Promise.all(record.rows.filter((r) => r.workItemId).map((r) => detail(tower.c1Engineer, r.workItemId!)));
    });

    it("creates a Draft for every good row and none for the bad", async () => {
      expect(record).toMatchObject({ status: "created", rowsTotal: 6, rowsRejected: 3, rowsCreated: 3 });
      expect(record.rows.map((r) => [r.rowNo, r.created])).toEqual([
        [4, true],
        [5, true],
        [7, false],
        [8, true],
        [9, false],
        [10, false],
      ]);
      const ids = record.rows.flatMap((r) => (r.workItemId ? [r.workItemId] : []));
      expect(ids).toHaveLength(3);
      expect((await listed(tower.c1Engineer)).filter((id) => !before.includes(id)).sort()).toEqual([...ids].sort());
    });

    it("makes ordinary Drafts: no Document Number, the row's Subject, Type and Trade, raised by the importer", () => {
      expect(drafts.map((d) => [d.title, d.type.code, d.documentNumber])).toEqual([
        ["Lighting fixtures, Floor 1", "MAR", null],
        ["Fire pump datasheet", "SAR", null],
        ["لوحات التوزيع", "DAR", null],
      ]);
      expect(drafts.map((d) => d.trade?.id)).toEqual([tower.electrical, tower.mechanical, tower.electrical]);
      for (const d of drafts) expect(d.stage.category).toBe("draft");
    });

    it("answers a second confirm with the same import, creating nothing more", async () => {
      const count = (await listed(tower.c1Engineer)).length;
      expect((await ok(confirm(tower.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 3 });
      expect(await listed(tower.c1Engineer)).toHaveLength(count);
    });

    it("is listed on the Imports page to every Member of the importing Company, with who imported it and no time", async () => {
      for (const by of [tower.c1Engineer, tower.c1Pm]) {
        const imports = await listImports(by);
        expect(imports.find((i: { id: string }) => i.id === previewed.id)).toEqual({
          id: previewed.id,
          fileName: "import-register.xlsx",
          status: "created",
          runBy: expect.objectContaining({ id: expect.any(String) }),
          rowsTotal: 6,
          rowsRejected: 3,
          rowsCreated: 3,
          packages: [],
        });
        const seen: RegisterImport = (await ok(getImport(by, previewed.id), 200)).json();
        expect(seen.rows.map((r) => r.reasons)).toEqual(record.rows.map((r) => r.reasons));
      }
    });

    it("lets an imported Draft be Deleted like any Draft, and the record still shows what the row created", async () => {
      const row = record.rows.find((r) => r.rowNo === 4)!;
      await ok(tower.c1Engineer.post(`/v1/work-items/${row.workItemId}/discard-draft`, {}), 204);
      const after: RegisterImport = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
      expect(after.rows.find((r) => r.rowNo === 4)).toMatchObject({ created: true, workItemId: null });
      expect(after.rowsCreated).toBe(3);
    });
  });

  it("refuses to confirm a preview with no good row", async () => {
    const bad = await preview(tower.c1Engineer, { ...register, mapping: { ...byColumns, subject: { column: 4 }, type: { column: 4 } } });
    expect(bad.rowsRejected).toBe(bad.rowsTotal);
    const res = await confirm(tower.c1Engineer, bad.id);
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "nothing_to_import" } });
  });
});

describe("One Type and one Trade for the whole file", () => {
  it("imports a .csv of Subjects only, every row with the fixed Type and Trade", async () => {
    const mapping: RegisterImportMapping = { subject: { column: 0 }, type: { value: "SAR" }, trade: { value: tower.mechanical } };
    const previewed = await preview(tower.c1Engineer, { file: csv, sheet: "import-register", headerRow: 1, mapping });
    expect(previewed.rows.map((r) => [r.subject, r.type.text, r.trade.text, r.reasons])).toEqual([
      ["Doors and frames", "SAR", "ME", []],
      ["أبواب الحريق", "SAR", "ME", []],
    ]);
    expect((await ok(confirm(tower.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 2 });
    const record: RegisterImport = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
    for (const row of record.rows) {
      const d = await detail(tower.c1Engineer, row.workItemId!);
      expect([d.type.code, d.trade?.id, d.documentNumber]).toEqual(["SAR", tower.mechanical, null]);
    }
  });

  it("refuses a fixed Trade that isn't the Project's, and a fixed Type the Member may not raise", async () => {
    const other = await tryPreview(tower.c1Engineer, { ...register, mapping: { ...byColumns, trade: { value: randomUUID() } } });
    expect(other.json()).toEqual({ error: "trade_not_found" });
    const snag = await tryPreview(tower.c1Engineer, { ...register, mapping: { ...byColumns, type: { value: "SNG" } } });
    expect(snag.json()).toEqual({ error: "type_not_found" });
  });
});

describe("The importer's Visibility", () => {
  it("makes a row bad whose Trade is outside it", async () => {
    const previewed = await preview(electricalOnly, register);
    expect(reasonsByRow(previewed)[5]).toEqual(["trade_outside_visibility"]);
    expect(reasonsByRow(previewed)[4]).toEqual([]);
  });

  it("refuses the whole confirm when a good row no longer passes, and creates nothing: preview again", async () => {
    const narrowed = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"]);
    const previewed = await preview(narrowed.caller, register);
    expect(previewed.rowsRejected).toBe(3);
    // Narrowed to Electrical after the preview: the Mechanical row would land outside it.
    await ok(
      c1.caller.request("PUT", `/v1/participants/${tower.c1ParticipantId}/members/${narrowed.id}/visibility`, {
        trade: only(tower.electrical),
        location: all,
      }),
    );
    const before = await listed(narrowed.caller);
    const res = await confirm(narrowed.caller, previewed.id);
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "preview_outdated" } });
    expect(await listed(narrowed.caller)).toEqual(before);
    const after: RegisterImport = (await ok(getImport(narrowed.caller, previewed.id), 200)).json();
    expect(after.status).toBe("previewed");
    expect(after.rows.every((r) => !r.created)).toBe(true);
  });
});

describe("RP-589-1: no other Company reads anything of C1's import", () => {
  let imported: RegisterImport;

  beforeAll(async () => {
    const previewed = await preview(tower.c1Engineer, register);
    await ok(confirm(tower.c1Engineer, previewed.id), 200);
    imported = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
  });

  it("gives C2, K1 and the Owner the plain 404 for the import, its rows and its confirm, as for a made-up id", async () => {
    for (const [who, by] of [
      ["C2", c2Engineer],
      ["K1 manager", tower.k1Manager],
      ["K1 engineer", k1Engineer],
      ["Owner", ownerPm],
    ] as const) {
      await expectHidden(getImport(by, imported.id), `${who} reads the import`);
      await expectHidden(confirm(by, imported.id), `${who} confirms the import`);
      expect(await listImports(by), `${who} lists imports`).toEqual([]);
    }
    await expectHidden(getImport(tower.c1Engineer, randomUUID()));
    await expectHidden(getImport(tower.c1Engineer, "not-an-id"));
  });

  it("leaves another Contractor's own preview and Imports page to itself", async () => {
    // C2 may raise Submittals too: its preview is its own, and C1 reads nothing of it.
    const theirs = await preview(c2Engineer, { ...register, mapping: { ...byColumns, trade: { value: tower.electrical } } });
    await expectHidden(getImport(tower.c1Engineer, theirs.id));
    await expectHidden(getImport(tower.c1Pm, theirs.id));
    expect((await listImports(tower.c1Engineer)).map((i: { id: string }) => i.id)).not.toContain(theirs.id);
  });
});

// RP-639: value matching, the optional fields (Scopes, Location, Form fields) and the Paper ref,
// on a Project of their own whose DAR Form adds a Planning section (a number, a date, a multiple
// choice and a Member).
describe("Values, optional fields and Paper ref (RP-639)", () => {
  const values = fixture("import-values.xlsx");
  /** import-values.xlsx: Ref, Description, النوع, Discipline, Scope, الموقع, Sheets, Issued, Document type, Remarks. */
  const full: RegisterImportMapping = {
    subject: { column: 1 },
    type: { column: 2 },
    trade: { column: 3 },
    scopes: { column: 4 },
    location: { column: 5 },
    paperRef: { column: 0 },
    fields: [
      { key: "sheets", column: 6 },
      { key: "issued_on", column: 7 },
      { key: "document_type", column: 8 },
    ],
  };
  const ofValues = (mapping: RegisterImportMapping) => ({ file: values, sheet: "Register", headerRow: 1, mapping });
  /** "Elec" is Electrical, and "Document" the DAR, matched by hand once. */
  let byHand: RegisterImportMapping;
  let at: Tower;
  let floor1 = "";
  let buildingB = "";
  let lighting = "";
  let emergency = "";
  let power = "";
  let preparer: { id: string; email: string };
  const projectUrl = (path: string) => `/v1/projects/${at.projectId}/${path}`;

  beforeAll(async () => {
    at = await buildTower(api, { c1, k1 }, "IMV");
    const created = async (path: string, body: object) => (await ok(c1.caller.post(projectUrl(path), body), 201)).json().id as string;
    floor1 = await created("locations", { code: "F1", name: bilingual("Floor 1"), parentId: at.buildingA });
    buildingB = await created("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
    lighting = await created("scopes", { tradeId: at.electrical, name: bilingual("Lighting") });
    emergency = await created("scopes", { tradeId: at.electrical, parentId: lighting, name: bilingual("Emergency lighting") });
    power = await created("scopes", { tradeId: at.electrical, name: bilingual("Power") });
    await created("scopes", { tradeId: at.mechanical, name: bilingual("Pumps") });
    // The Project's own DAR Form: the Rabaed Default's fields and a Planning section.
    const planning = {
      key: "planning",
      title: { en: "Planning", ar: "التخطيط" },
      fields: [
        { key: "sheets", type: "number", label: { en: "Sheets", ar: "عدد اللوحات" }, min: 1 },
        { key: "issued_on", type: "date", label: { en: "Issue date", ar: "تاريخ الإصدار" } },
        {
          key: "copies",
          type: "multi_select",
          label: { en: "Copies", ar: "النسخ" },
          options: [
            { value: "paper", label: { en: "Paper", ar: "ورقية" } },
            { value: "digital", label: { en: "Digital", ar: "رقمية" } },
          ],
        },
        { key: "prepared_by", type: "member", label: { en: "Prepared by", ar: "أعده" } },
      ],
    };
    await sql`
      with f as (
        insert into form_definition (owner_kind, project_id, name, work_item_type_id)
        values ('project', ${at.projectId}::uuid, '{"en": "DAR", "ar": "DAR"}'::jsonb,
          (select id from work_item_type where owner_kind = 'rabaed' and code = 'DAR'))
        returning id
      )
      insert into form_version (form_definition_id, version_no, status, schema, published_at)
      select f.id, 1, 'published', jsonb_set(r.schema, '{sections}', (r.schema -> 'sections') || jsonb_build_array(${JSON.stringify(planning)}::jsonb)), now()
      from f, form_version r where r.id = app.latest_form_version('DAR')
    `.execute(migrator);
    byHand = { ...full, values: { trade: { elec: at.electrical }, type: { document: "DAR" } } };
    preparer = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Hana Preparer" });
  });

  it("suggests every column's field from its heading, in English or Arabic, Form fields of the Types' Forms included", async () => {
    const sheet: RegisterSheet = (await ok(read(at.c1Engineer, { file: values }, at.projectId), 200)).json();
    expect(sheet.suggestions.map((s) => s?.field ?? null)).toEqual([
      "paperRef",
      "subject",
      "type",
      "trade",
      "scopes",
      "location",
      "field:sheets",
      "field:issued_on",
      "field:document_type",
      null,
    ]);
  });

  it("lists what a register may fill: the Types, the Project's values, and the simple Form fields with their choices", async () => {
    const fields: RegisterImportFields = (await ok(at.c1Engineer.get(projectUrl("register-imports/fields")), 200)).json();
    expect(fields.types.map((t) => t.code)).toEqual(expect.arrayContaining(["MAR", "SAR", "DAR"]));
    expect(fields.locations.find((l) => l.id === floor1)?.path.en).toBe("Building A / Floor 1");
    expect(fields.scopes.find((s) => s.id === emergency)).toMatchObject({ tradeId: at.electrical, parentId: lighting });
    const byKey = Object.fromEntries(fields.formFields.map((f) => [f.key, f]));
    expect(byKey.sheets).toMatchObject({ type: "number", types: ["DAR"] });
    expect(byKey.document_type!.options.map((o) => o.value)).toEqual(["report", "calculation", "plan", "procedure", "other"]);
    expect(byKey.manufacturer).toMatchObject({ type: "text", types: expect.arrayContaining(["MAR"]) });
    // Never a field the register can't fill (files, tables, links, a Built-in Field), nor a section the Draft can't edit.
    for (const key of ["document", "items", "related_submittals", "trade", "location", "scopes", "verification_note"]) {
      expect(byKey[key], key).toBeUndefined();
    }
  });

  it("lists each column's values once, ignoring case and spaces, with what each matches", async () => {
    const before: RegisterValues = (await ok(at.c1Engineer.post(projectUrl("register-imports/values"), ofValues(full)), 200)).json();
    const of = (result: RegisterValues, field: string) =>
      Object.fromEntries(result.fields.find((f) => f.field === field)!.values.map((v) => [v.text, [v.rows, v.match, v.how]]));
    expect(of(before, "type")).toEqual({ dar: [5, "DAR", "exact"], Document: [1, "DAR", "suggested"], mar: [1, "MAR", "exact"] });
    expect(of(before, "trade")).toEqual({
      electrical: [2, at.electrical, "exact"],
      Elec: [2, at.electrical, "suggested"],
      Mechanical: [3, at.mechanical, "exact"],
    });
    const after: RegisterValues = (await ok(at.c1Engineer.post(projectUrl("register-imports/values"), ofValues(byHand)), 200)).json();
    expect(of(after, "trade").Elec).toEqual([2, at.electrical, "manual"]);
    expect(of(after, "location")).toMatchObject({ "building a / floor 1": [1, floor1, "exact"], BA: [1, at.buildingA, "exact"], "Tower 9": [1, null, null] });
    expect(after.fields.map((f) => f.field)).toEqual(["type", "trade", "location", "scopes", "field:document_type"]);
  });

  describe("a suggestion pre-chosen and not yet confirmed (RP-961)", () => {
    /** "Elec" is still Electrical as suggested; "Document" was confirmed as the DAR. */
    const unconfirmed = () => ({ ...byHand, suggested: { trade: ["elec"] } });

    it("stays suggested, with its score, until confirmed; an exact match never is", async () => {
      const result: RegisterValues = (await ok(at.c1Engineer.post(projectUrl("register-imports/values"), ofValues(unconfirmed())), 200)).json();
      const of = (field: string) => Object.fromEntries(result.fields.find((f) => f.field === field)!.values.map((v) => [v.text, [v.match, v.how]]));
      expect(of("trade")).toEqual({ electrical: [at.electrical, "exact"], Elec: [at.electrical, "suggested"], Mechanical: [at.mechanical, "exact"] });
      expect(result.fields.find((f) => f.field === "trade")!.values.find((v) => v.text === "Elec")!.score).toBeGreaterThanOrEqual(60);
      expect(of("type")).toEqual({ dar: ["DAR", "exact"], Document: ["DAR", "manual"], mar: ["MAR", "exact"] });
      // Changed to another value: matched by hand, whatever the mapping says.
      const changed = { ...unconfirmed(), values: { ...byHand.values, trade: { elec: at.mechanical } } };
      const after: RegisterValues = (await ok(at.c1Engineer.post(projectUrl("register-imports/values"), ofValues(changed)), 200)).json();
      expect(after.fields.find((f) => f.field === "trade")!.values.find((v) => v.text === "Elec")).toMatchObject({ match: at.mechanical, how: "manual", score: null });
    });

    it("counts the good rows using one on the preview, which imports them as matched", async () => {
      const previewed: RegisterImport = (await ok(tryPreview(at.c1Engineer, ofValues(unconfirmed()), at.projectId), 201)).json();
      expect(previewed.mapping.suggested).toEqual({ trade: ["elec"] });
      // Rows 3 ("Elec") and 4 ("ELEC"), of the good rows 2, 3, 4 and 8.
      expect(previewed.rowsSuggested).toBe(2);
      expect(previewed.rows.find((r) => r.rowNo === 4)!.trade.match?.id).toBe(at.electrical);
      const confirmed: RegisterImport = (await ok(tryPreview(at.c1Engineer, ofValues(byHand), at.projectId), 201)).json();
      expect(confirmed.rowsSuggested).toBe(0);
    });
  });

  describe("previewed and confirmed", () => {
    let previewed: RegisterImport;
    let record: RegisterImport;

    beforeAll(async () => {
      previewed = await (await ok(tryPreview(at.c1Engineer, ofValues(byHand), at.projectId), 201)).json();
    });

    it("matches in either language, ignoring case and spaces, and one value matched by hand fills every row with it", () => {
      expect(reasonsByRow(previewed)).toEqual({
        2: [],
        3: [],
        4: [],
        5: ["scope_not_under_trade", "location_unknown", "field_invalid", "paper_ref_repeated"],
        6: ["scope_unknown", "paper_ref_repeated"],
        7: ["paper_ref_too_long"],
        8: [],
      });
      const row = (n: number) => previewed.rows.find((r) => r.rowNo === n)!;
      expect([row(2).type.match?.code, row(2).trade.match?.id]).toEqual(["DAR", at.electrical]);
      // "Elec" and "ELEC" both, by the one match made by hand; "Document" too.
      expect([row(3).trade.match?.id, row(4).trade.match?.id, row(4).type.match?.code]).toEqual([at.electrical, at.electrical, "DAR"]);
      expect(row(2).location).toEqual({ text: "building a / floor 1", match: expect.objectContaining({ id: floor1 }) });
      expect(row(2).scopes.matches.map((s) => s.id)).toEqual([lighting, emergency]);
      expect(row(5).fields).toEqual([
        { key: "sheets", text: "twelve", invalid: true },
        { key: "issued_on", text: "05-Nov-26", invalid: true },
        { key: "document_type", text: "Blueprint", invalid: true },
      ]);
      // Labels as the Form names them, for the record.
      expect(previewed.mapping.fields?.map((f) => f.label?.en)).toEqual(["Sheets", "Issue date", "Document type"]);
    });

    it("reads cells as stored: a Paper ref typed as a number loses its zeros, a date cell reads as its date", () => {
      const row3 = previewed.rows.find((r) => r.rowNo === 3)!;
      expect(row3.paperRef).toBe("12");
      expect(row3.fields.find((f) => f.key === "issued_on")).toEqual({ key: "issued_on", text: "2026-11-09", invalid: false });
    });

    describe("on confirm", () => {
      let drafts: Record<number, WorkItemDetail>;

      beforeAll(async () => {
        expect((await ok(confirm(at.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 4 });
        record = (await ok(getImport(at.c1Engineer, previewed.id), 200)).json();
        drafts = Object.fromEntries(
          await Promise.all(record.rows.filter((r) => r.workItemId).map(async (r) => [r.rowNo, await detail(at.c1Engineer, r.workItemId!)] as const)),
        );
      });

      it("fills the Scopes, Location, Paper ref and mapped Form fields, and leaves every other field empty", () => {
        expect(Object.keys(drafts).map(Number)).toEqual([2, 3, 4, 8]);
        expect(drafts[2]).toMatchObject({ paperRef: "DAR-P-001", location: { id: floor1 }, documentNumber: null });
        expect(drafts[2]!.scopes.map((s) => s.id)).toEqual([lighting, emergency]);
        expect(drafts[2]!.answers).toMatchObject({ sheets: 12, issued_on: "2026-11-05", document_type: "plan" });
        expect(drafts[2]!.answers).not.toHaveProperty("document_title");
        expect(drafts[3]).toMatchObject({ paperRef: "12", location: { id: at.buildingA } });
        expect(drafts[3]!.scopes.map((s) => s.id)).toEqual([power]);
        expect(drafts[3]!.answers).toMatchObject({ sheets: 3, issued_on: "2026-11-09", document_type: "report" });
        expect(drafts[4]).toMatchObject({ paperRef: "DAR-P-004", location: null, scopes: [] });
        // The MAR's Form has no Sheets field: its cell is left out.
        expect(drafts[8]!.type.code).toBe("MAR");
        expect(drafts[8]!.answers).not.toHaveProperty("sheets");
      });

      it("refuses a Paper ref the Participant already holds on the Project, whatever its case", async () => {
        const again: RegisterImport = await (await ok(tryPreview(at.c1Engineer, ofValues(byHand), at.projectId), 201)).json();
        expect(reasonsByRow(again)[2]).toEqual(["paper_ref_taken"]);
        expect(reasonsByRow(again)[3]).toEqual(["paper_ref_taken"]);
      });

      it("finds a Draft by its Paper ref in the List's search", async () => {
        const found = (await ok(at.c1Engineer.get(projectUrl("modules/submittals/work-items?q=DAR-P-004")), 200)).json();
        expect(found.items.map((i: { id: string }) => i.id)).toEqual([record.rows.find((r) => r.rowNo === 4)!.workItemId]);
      });
    });
  });

  it("RP-589-4: makes a row bad whose Location is outside the importer's Visibility", async () => {
    const narrowed = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"]);
    await ok(
      c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${narrowed.id}/visibility`, { trade: all, location: only(buildingB) }),
    );
    const previewed: RegisterImport = await (await ok(tryPreview(narrowed.caller, ofValues({ ...byHand, paperRef: undefined }), at.projectId), 201)).json();
    expect(reasonsByRow(previewed)[2]).toEqual(["location_outside_visibility"]);
    expect(reasonsByRow(previewed)[4]).toEqual([]);
  });

  it("fills a Member field from the Member's email or name when only one matches, a multiple choice from its options", async () => {
    const register = (rows: string[][]) => ({
      fileName: "people.csv",
      content: Buffer.from(["Subject,Type,Trade,Prepared by,Copies", ...rows.map((r) => r.join(","))].join("\n")).toString("base64"),
    });
    const file = register([
      ["By email", "DAR", "Electrical", preparer.email.toUpperCase(), "paper"],
      ["By name", "DAR", "Electrical", "hana preparer", "Paper; DIGITAL"],
      ["Nobody", "DAR", "Electrical", "Someone Else", "Fax"],
    ]);
    const mapping: RegisterImportMapping = {
      subject: { column: 0 },
      type: { column: 1 },
      trade: { column: 2 },
      fields: [
        { key: "prepared_by", column: 3 },
        { key: "copies", column: 4 },
      ],
    };
    const previewed: RegisterImport = await (await ok(tryPreview(at.c1Engineer, { file, sheet: "people", headerRow: 1, mapping }, at.projectId), 201)).json();
    expect(reasonsByRow(previewed)).toEqual({ 2: [], 3: [], 4: ["field_invalid"] });
    expect((await ok(confirm(at.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 2 });
    const record: RegisterImport = (await ok(getImport(at.c1Engineer, previewed.id), 200)).json();
    const made = await Promise.all(record.rows.filter((r) => r.workItemId).map((r) => detail(at.c1Engineer, r.workItemId!)));
    expect(made.map((d) => [d.answers.prepared_by, d.answers.copies])).toEqual([
      [preparer.id, ["paper"]],
      [preparer.id, ["paper", "digital"]],
    ]);
  });

  it("refuses a Form field no Type the Member may raise has", async () => {
    const res = await tryPreview(at.c1Engineer, ofValues({ ...full, fields: [{ key: "not_a_field", column: 9 }] }), at.projectId);
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: { error: "field_not_found" } });
  });

  describe("The Paper ref on the item", () => {
    let mine = "";
    let other = "";

    beforeAll(async () => {
      const make = async (title: string) =>
        (await ok(at.c1Engineer.post(projectUrl("work-items"), { type: "DAR", title, answers: { trade: at.electrical } }), 201)).json().id as string;
      mine = await make("Paper ref by hand");
      other = await make("Another Draft");
    });

    const setRef = (by: Caller, id: string, paperRef: string | null) => by.request("PUT", `/v1/work-items/${id}/paper-ref`, { paperRef });

    it("is set and cleared by the raiser while it is a Draft, and shown on the item", async () => {
      expect((await detail(at.c1Engineer, mine)).actions.editPaperRef).toBe(true);
      await ok(setRef(at.c1Engineer, mine, "  OLD-77 "));
      expect((await detail(at.c1Engineer, mine)).paperRef).toBe("OLD-77");
      await ok(setRef(at.c1Engineer, other, "OLD-78"));
      await ok(setRef(at.c1Engineer, other, " "));
      expect((await detail(at.c1Engineer, other)).paperRef).toBeNull();
    });

    it("refuses one another item of the Participant holds, whatever its case, and one over 100 characters", async () => {
      const taken = await setRef(at.c1Engineer, other, "old-77");
      expect({ status: taken.statusCode, body: taken.json() }).toEqual({ status: 409, body: { error: "paper_ref_taken" } });
      const long = await setRef(at.c1Engineer, other, "R".repeat(101));
      expect({ status: long.statusCode, body: long.json() }).toEqual({ status: 422, body: { error: "paper_ref_too_long" } });
    });

    it("is not editable by a colleague who may not edit the Draft, nor once numbered, and hidden from another Company", async () => {
      expect((await detail(at.c1Pm, mine)).actions.editPaperRef).toBe(false);
      const colleague = await setRef(at.c1Pm, mine, "OLD-79");
      expect({ status: colleague.statusCode, body: colleague.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
      const numbered = await submitted(at, at.c1Engineer, at.c1Pm, "Numbered");
      expect((await detail(at.c1Engineer, numbered)).actions.editPaperRef).toBe(false);
      const refused = await setRef(at.c1Engineer, numbered, "OLD-80");
      expect(refused.json()).toEqual({ error: "not_editable" });
      await expectHidden(setRef(at.k1Manager, mine, "OLD-81"));
      await expectHidden(setRef(at.c1Engineer, randomUUID(), "OLD-82"));
    });
  });
});

// RP-640 (stories 24–26; visibility.md RP-589-2): a row is raised by the Member it is
// assigned to, by email in an "Assign to" column, else by a group rule (by Trade or
// Type), else by the default, else by the importer. The assignee must be an active Member
// of the importing Participant on the Project who may raise the row's Type and covers its
// values; the Draft is their own, and each assignee but the importer hears of it once.
describe("RP-589-3: a Rabaed Engineer's import for C1 (RP-645)", () => {
  const engineerName = "Yousef Engineer Qahtani";
  let engineer: { id: string; email: string; fullName: string };
  let imported: RegisterImport;
  let defaultMember: Awaited<ReturnType<typeof memberOnProject>>;
  /** What a reader got back from the import, the Imports page and a Draft's history, as sent. */
  const bodies = async (by: Caller) => [
    (await ok(getImport(by, imported.id), 200)).body,
    (await ok(by.get(`/v1/projects/${tower.projectId}/register-imports`), 200)).body,
    (await ok(by.get(`/v1/work-items/${imported.rows.find((r) => r.workItemId)!.workItemId}/history`), 200)).body,
  ];

  beforeAll(async () => {
    defaultMember = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: "Hafiz Default" });
    const done = await api.engineerImport(
      {
        for: { projectId: tower.projectId, participantId: tower.c1ParticipantId, defaultMemberId: defaultMember.id, reason: "Onboarding C1, ticket 4821" },
        ...register,
        file: { ...xlsx, fileName: "engineer-register.xlsx" },
      },
      engineerName,
    );
    engineer = done.engineer;
    expect(done.rowsCreated).toBe(3);
    imported = (await ok(getImport(defaultMember.caller, done.importId), 200)).json();
  });

  it("is listed to C1's Members with \"Rabaed\" as who imported it (no Member), the file name and the counts, and no time", async () => {
    for (const by of [defaultMember.caller, tower.c1Pm]) {
      const imports = await listImports(by);
      expect(imports.find((i: { id: string }) => i.id === imported.id)).toEqual({
        id: imported.id,
        fileName: "engineer-register.xlsx",
        status: "created",
        runBy: null,
        rowsTotal: 6,
        rowsRejected: 3,
        rowsCreated: 3,
        packages: [],
      });
      // Its unassigned rows' raiser is the Company's own default Member.
      expect((await ok(getImport(by, imported.id), 200)).json()).toMatchObject({
        runBy: null,
        status: "created",
        defaultRaiser: { id: defaultMember.id, name: bilingual("Hafiz Default") },
      });
    }
  });

  it("says in each of its Drafts' history that Rabaed imported it, from which import, with no time; the Draft is the default Member's", async () => {
    const id = imported.rows.find((r) => r.workItemId)!.workItemId!;
    for (const by of [defaultMember.caller, tower.c1Pm]) {
      const history = (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json();
      expect(history.imported).toEqual({ importId: imported.id, fileName: "engineer-register.xlsx", byRabaed: true, memberName: null });
    }
    const mine = (await ok(defaultMember.caller.get(`/v1/projects/${tower.projectId}/work-items?needMyAction=true`), 200)).json().items;
    expect(mine.map((i: { id: string }) => i.id)).toContain(id);
  });

  it("says in a Member's imported Draft's history who imported it (story 35)", async () => {
    const mapping: RegisterImportMapping = { subject: { column: 0 }, type: { value: "SAR" }, trade: { value: tower.mechanical } };
    const own = await preview(defaultMember.caller, { file: csv, sheet: "import-register", headerRow: 1, mapping });
    await ok(confirm(defaultMember.caller, own.id), 200);
    const id = (await ok(getImport(defaultMember.caller, own.id), 200)).json().rows[0].workItemId;
    const history = (await ok(tower.c1Pm.get(`/v1/work-items/${id}/history`), 200)).json();
    expect(history.imported).toEqual({ importId: own.id, fileName: "import-register.csv", byRabaed: false, memberName: bilingual("Hafiz Default") });
  });

  it("never names the Engineer, nor when the import ran, to C1's Members", async () => {
    for (const by of [defaultMember.caller, tower.c1Pm]) {
      for (const body of await bodies(by)) {
        expect(body).not.toContain(engineerName);
        expect(body).not.toContain(engineer.email);
        expect(body).not.toContain(engineer.id);
        expect(body).not.toMatch(/"(createdAt|confirmedAt|created_at|confirmed_at|importedAt)"/);
      }
    }
  });

  it("gives K1 nothing of it: the plain 404 for the import and its Drafts, an empty Imports page", async () => {
    for (const by of [tower.k1Manager, k1Engineer]) {
      await expectHidden(getImport(by, imported.id));
      await expectHidden(confirm(by, imported.id));
      expect(await listImports(by)).toEqual([]);
      for (const row of imported.rows.filter((r) => r.workItemId)) await expectHidden(by.get(`/v1/work-items/${row.workItemId}`));
    }
  });
});

describe("Assign to (RP-640)", () => {
  type Person = Awaited<ReturnType<typeof memberOnProject>>;
  let at: Tower;
  let c1Co: Company;
  /** A C1 engineer whose Trade Visibility is Electrical only. */
  let narrowed: Person;
  let colleague: Person;
  /** A C1 Member on the Project with no Position: holds no Create, so may not raise a DAR there. */
  let noCreate: Person;
  let leaver: Person;
  let deactivated: Person;
  let k1Person: Person;
  let previewed: RegisterImport;

  // The worker connects as the app role, with no Member set.
  const worker = createDb(testDatabaseUrls().app, { max: 1 });
  afterAll(() => worker.destroy());

  const csvOf = (rows: string[][]) => ({
    fileName: "assign.csv",
    content: Buffer.from(["Subject,Type,Trade,Assign to", ...rows.map((r) => r.join(","))].join("\r\n")).toString("base64"),
  });
  const notifications = async (by: Caller) => (await ok(by.get("/v1/notifications"), 200)).json().notifications as Record<string, unknown>[];

  beforeAll(async () => {
    c1Co = await api.projectCreator();
    const k1Co = await api.authorizedPerson();
    at = await buildTower(api, { c1: c1Co, k1: k1Co }, "ASG");
    const k1ParticipantId = (await c1Co.caller.get(`/v1/projects/${at.projectId}/participants`))
      .json()
      .participants.find((p: { projectRole: { baseRole: string } }) => p.projectRole.baseRole === "consultant").id;
    narrowed = await memberOnProject(api, c1Co, at.c1ParticipantId, ["engineer"], { trade: only(at.electrical), name: "Faisal Narrowed" });
    colleague = await memberOnProject(api, c1Co, at.c1ParticipantId, ["engineer"], { name: "Omar Colleague" });
    noCreate = await memberOnProject(api, c1Co, at.c1ParticipantId, [], { name: "Sami No Create" });
    leaver = await memberOnProject(api, c1Co, at.c1ParticipantId, ["engineer"]);
    deactivated = await memberOnProject(api, c1Co, at.c1ParticipantId, ["engineer"]);
    k1Person = await memberOnProject(api, k1Co, k1ParticipantId, ["engineer"]);
    await ok(c1Co.caller.delete(`/v1/participants/${at.c1ParticipantId}/members/${leaver.id}`));
    await ok(c1Co.caller.post(`/v1/members/${deactivated.id}/deactivate`, {}), 200);
    // On this Project, C1's DAR runs on the Snag's Workflow, whose Draft its raiser holds
    // with the Create Function Permission (RP-622): a Member with no Position may not raise one.
    await sql`
      insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id)
      select ${at.projectId}::uuid, t.id, ${at.c1ParticipantId}::uuid,
        (select s.workflow_definition_id from work_item_type s where s.owner_kind = 'rabaed' and s.code = 'SNG')
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = 'DAR'
    `.execute(migrator);

    const file = csvOf([
      ["Panels", "MAR", "Electrical", narrowed.email.toUpperCase()],
      ["Pumps", "MAR", "Mechanical", ` ${narrowed.email} `],
      ["Fans", "SAR", "Electrical", ""],
      ["Valves", "SAR", "Mechanical", ""],
      ["Doors", "MAR", "Mechanical", ""],
      ["Signage", "DAR", "Electrical", noCreate.email],
      ["Railings", "MAR", "Electrical", k1Person.email],
      ["Glazing", "MAR", "Electrical", leaver.email],
      ["Ceilings", "MAR", "Electrical", deactivated.email],
      ["Paint", "MAR", "Electrical", "nobody@rabaed.test"],
    ]);
    const mapping: RegisterImportMapping = {
      subject: { column: 0 },
      type: { column: 1 },
      trade: { column: 2 },
      assignTo: { column: 3 },
      assign: { default: colleague.id, rules: [{ by: "type", value: "SAR", member: narrowed.id }] },
    };
    previewed = (await ok(tryPreview(at.c1Pm, { file, sheet: "assign", headerRow: 1, mapping }, at.projectId), 201)).json();
  });

  it("offers the active Members of the importer's own Participant on the Project to assign rows to, and nobody else", async () => {
    const fields: RegisterImportFields = (await ok(at.c1Pm.get(`/v1/projects/${at.projectId}/register-imports/fields`), 200)).json();
    const ids = fields.members.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([narrowed.id, colleague.id, noCreate.id]));
    expect(fields.members.find((m) => m.id === narrowed.id)).toEqual({ id: narrowed.id, name: bilingual("Faisal Narrowed"), email: narrowed.email });
    for (const gone of [leaver.id, deactivated.id, k1Person.id]) expect(ids).not.toContain(gone);
  });

  it("suggests the Assign to field for an \"Assign to\" column", async () => {
    const file = csvOf([["Panels", "MAR", "Electrical", narrowed.email]]);
    const sheet: RegisterSheet = (await ok(read(at.c1Pm, { file }, at.projectId), 200)).json();
    expect(sheet.suggestions.map((s) => s?.field ?? null)).toEqual(["subject", "type", "trade", "assignTo"]);
  });

  it("lists the Assign to column's emails once, with the Member each names exactly, never a suggestion", async () => {
    const file = csvOf([
      ["Panels", "MAR", "Electrical", narrowed.email.toUpperCase()],
      ["Pumps", "MAR", "Mechanical", narrowed.email],
      ["Doors", "MAR", "Mechanical", `x${colleague.email}`],
    ]);
    const mapping: RegisterImportMapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 }, assignTo: { column: 3 } };
    const values: RegisterValues = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/register-imports/values`, { file, sheet: "assign", headerRow: 1, mapping }), 200)).json();
    expect(values.fields.find((f) => f.field === "assignTo")!.values.map((v) => [v.rows, v.match, v.how])).toEqual([
      [2, narrowed.id, "exact"],
      [1, null, null],
    ]);
  });

  it("assigns a row by its email in the Assign to column, ignoring case, else by a group rule, else by the default", () => {
    const assignee = Object.fromEntries(previewed.rows.map((r) => [r.subject, r.assignee.match?.id ?? null]));
    expect(assignee).toMatchObject({ Panels: narrowed.id, Pumps: narrowed.id, Fans: narrowed.id, Valves: narrowed.id, Doors: colleague.id, Signage: noCreate.id });
    expect(previewed.rows.find((r) => r.subject === "Panels")!.assignee).toEqual({
      text: narrowed.email.toUpperCase(),
      match: { id: narrowed.id, name: bilingual("Faisal Narrowed") },
    });
    expect(previewed.rows.find((r) => r.subject === "Fans")!.assignee.text).toBe("");
  });

  it("RP-589-2: refuses the Mechanical rows assigned to the engineer narrowed to Electrical, and an assignee who may not raise the Type", () => {
    expect(reasonsByRow(previewed)).toEqual({
      2: [],
      3: ["assignee_outside_visibility"],
      4: [],
      5: ["assignee_outside_visibility"],
      6: [],
      7: ["assignee_cannot_create"],
      8: ["assignee_unknown"],
      9: ["assignee_unknown"],
      10: ["assignee_unknown"],
      11: ["assignee_unknown"],
    });
  });

  it("refuses an email of another Company's Member, a Member taken off the Project or deactivated, and an unknown one alike, naming nobody", () => {
    for (const subject of ["Railings", "Glazing", "Ceilings", "Paint"]) {
      expect(previewed.rows.find((r) => r.subject === subject)!.assignee.match).toBeNull();
    }
  });

  describe("on confirm", () => {
    let record: RegisterImport;
    /** The outbox rows of the Project the confirm wrote, before the worker took them. */
    let outboxOfConfirm: { kind: string }[];
    const draftOf = (subject: string) => record.rows.find((r) => r.subject === subject)!.workItemId!;

    beforeAll(async () => {
      const outbox = async () => (await sql<{ id: string; kind: string }>`select id, kind from outbox where project_id = ${at.projectId}::uuid`.execute(migrator)).rows;
      const before = new Set((await outbox()).map((o) => o.id));
      expect((await ok(confirm(at.c1Pm, previewed.id), 200)).json()).toEqual({ rowsCreated: 3 });
      outboxOfConfirm = (await outbox()).filter((o) => !before.has(o.id)).map(({ kind }) => ({ kind }));
      record = (await ok(getImport(at.c1Pm, previewed.id), 200)).json();
      await drainOutbox(worker);
    });

    it("RP-589-2: creates the assignee's Drafts inside their Visibility only", async () => {
      expect(record.rows.filter((r) => r.created).map((r) => r.subject)).toEqual(["Panels", "Fans", "Doors"]);
      const theirs = (await ok(narrowed.caller.get(`/v1/projects/${at.projectId}/modules/submittals/work-items?pageSize=50`), 200)).json().items;
      expect(theirs.map((i: { title: string }) => i.title).sort()).toEqual(["Fans", "Panels"]);
    });

    it("makes the Draft the assignee's own: in their Need My Action, never counted, and theirs to edit", async () => {
      const mine = (await ok(narrowed.caller.get(`/v1/projects/${at.projectId}/work-items?needMyAction=true`), 200)).json().items;
      expect(mine.map((i: { id: string }) => i.id).sort()).toEqual([draftOf("Panels"), draftOf("Fans")].sort());
      const projects = (await ok(narrowed.caller.get("/v1/projects"), 200)).json().projects;
      expect(projects.find((p: { id: string }) => p.id === at.projectId).needMyAction).toBe(0);
      const panels = await detail(narrowed.caller, draftOf("Panels"));
      expect(panels.actions).toMatchObject({ saveAnswers: true, editPaperRef: true, discardDraft: true });
      expect(panels.stage.category).toBe("draft");
      // Not the importer's: it is in nobody else's Need My Action.
      const importers = (await ok(at.c1Pm.get(`/v1/projects/${at.projectId}/work-items?needMyAction=true`), 200)).json().items;
      expect(importers.map((i: { id: string }) => i.id)).not.toContain(draftOf("Panels"));
    });

    it("tells nobody: no notification, email or digest entry, for an assignee or anyone else (owner, 2026-10-19)", async () => {
      // Its time would be the import's, when the Drafts were started (scenario 61).
      expect(outboxOfConfirm).toEqual([]);
      const drafts = ["Panels", "Fans", "Doors"].map(draftOf);
      const notified = await sql<{ member_id: string }>`select member_id from notification where work_item_id = any(${drafts}::uuid[])`.execute(migrator);
      expect(notified.rows).toEqual([]);
      for (const by of [narrowed.caller, colleague.caller, noCreate.caller, at.c1Pm, k1Person.caller, at.k1Manager]) {
        expect((await notifications(by)).filter((n) => drafts.includes(n.workItemId as string))).toEqual([]);
      }
    });
  });
});

// RP-644 (stories 11, 17, 28–31, 34): Packages from an import, the original register's
// download, and saved mappings, on the Tower. C1's new Packages are C1's alone (RP-589-1).
describe("Packages, the original register and saved mappings (RP-644)", () => {
  /** A .csv register: Subject, Type, Trade, Package. */
  const packageCsv = {
    fileName: "Packages register.csv",
    content: Buffer.from(
      [
        "Subject,Type,Trade,Package",
        "Basins,MAR,Electrical,Bathrooms",
        "Taps,MAR,Electrical,  bath ROOMS ",
        "Cable trays,MAR,Electrical,electrical level 1",
        "Pumps,SAR,Mechanical,Started set",
        "Doors,MAR,Electrical,",
      ].join("\n"),
      "utf8",
    ).toString("base64"),
  };
  const byPackage: RegisterImportMapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 }, package: { column: 3 } };
  const packageRegister = { file: packageCsv, sheet: "Packages register", headerRow: 1, mapping: byPackage };
  const createPackage = async (by: Caller, name: string): Promise<{ id: string; number: string }> =>
    (await ok(by.post(`/v1/projects/${tower.projectId}/packages`, { name: { en: name, ar: name } }), 201)).json();
  const fields = async (by: Caller): Promise<RegisterImportFields> => (await ok(by.get(`/v1/projects/${tower.projectId}/register-imports/fields`), 200)).json();
  const packageOf = (imported: RegisterImport, rowNo: number) => imported.rows.find((r) => r.rowNo === rowNo)!.package;
  let open: { id: string; number: string };
  let started: { id: string; number: string };
  let theirs: { id: string; number: string };

  beforeAll(async () => {
    open = await createPackage(tower.c1Engineer, "Electrical Level 1");
    started = await createPackage(tower.c1Engineer, "Started set");
    theirs = await createPackage(c2Engineer, "C2 set");
    // As a Submit leaves it.
    await sql`update package set status = 'in_progress' where id = ${started.id}::uuid`.execute(migrator);
  });

  it("offers the importer's own Company's Packages, each with its number and status, and suggests the Package field", async () => {
    const offered = (await fields(tower.c1Engineer)).packages;
    expect(offered).toEqual(
      expect.arrayContaining([
        { id: open.id, number: open.number, name: bilingual("Electrical Level 1"), status: "open" },
        { id: started.id, number: started.number, name: bilingual("Started set"), status: "in_progress" },
      ]),
    );
    expect(offered.map((p) => p.id)).not.toContain(theirs.id);
    expect((await fields(c2Engineer)).packages.map((p) => p.id)).toEqual([theirs.id]);
    const sheet: RegisterSheet = (await ok(read(tower.c1Engineer, { file: packageCsv }), 200)).json();
    expect(sheet.suggestions[3]?.field).toBe("package");
  });

  it("lists the Package column's names once, ignoring case and spaces, each with the Company's own Package it matches", async () => {
    const values: RegisterValues = (await ok(tower.c1Engineer.post(`/v1/projects/${tower.projectId}/register-imports/values`, packageRegister), 200)).json();
    expect(values.fields.find((f) => f.field === "package")!.values).toEqual([
      { key: "bathrooms", text: "Bathrooms", rows: 2, match: null, how: null, score: null },
      { key: "electricallevel1", text: "electrical level 1", rows: 1, match: open.id, how: "exact", score: null },
      { key: "startedset", text: "Started set", rows: 1, match: started.id, how: "exact", score: null },
    ]);
  });

  describe("by a Package column", () => {
    let previewed: RegisterImport;
    let before: string[];

    beforeAll(async () => {
      before = (await fields(tower.c1Engineer)).packages.map((p) => p.id);
      previewed = await preview(tower.c1Engineer, packageRegister);
    });

    it("previews each row's Package: a new one per name, an Open one it names, and refuses an In Progress one", () => {
      expect(reasonsByRow(previewed)).toEqual({ 2: [], 3: [], 4: [], 5: ["package_not_open"], 6: [] });
      expect(packageOf(previewed, 2)).toEqual({ text: "Bathrooms", match: null, new: "Bathrooms" });
      expect(packageOf(previewed, 3)).toEqual({ text: "bath ROOMS", match: null, new: "Bathrooms" });
      expect(packageOf(previewed, 4)).toMatchObject({ text: "electrical level 1", match: { id: open.id, number: open.number, status: "open" }, new: null });
      expect(packageOf(previewed, 5)).toMatchObject({ match: { id: started.id, status: "in_progress" } });
      expect(packageOf(previewed, 6)).toEqual({ text: "", match: null, new: null });
      // What confirm will do: one new Package of two rows, and one row added to an Open one.
      expect(previewed.packages).toEqual([
        { package: null, newName: "Bathrooms", rows: 2 },
        { package: expect.objectContaining({ id: open.id }), newName: null, rows: 1 },
      ]);
    });

    it("creates no Package before confirm", async () => {
      expect((await fields(tower.c1Engineer)).packages.map((p) => p.id)).toEqual(before);
    });

    describe("on confirm", () => {
      let record: RegisterImport;
      let created: string;

      beforeAll(async () => {
        expect((await ok(confirm(tower.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 4 });
        record = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
        created = record.packages.find((p) => p.newName === "Bathrooms")!.package!.id;
      });

      it("creates the new Package with the next number, and puts each Draft in its Package", async () => {
        const numbers = (await fields(tower.c1Engineer)).packages.map((p) => p.number);
        const made = record.packages.find((p) => p.newName === "Bathrooms")!;
        expect(made).toEqual({ package: { id: created, number: numbers.at(-1), name: bilingual("Bathrooms"), status: "open" }, newName: "Bathrooms", rows: 2 });
        const pkg = (await ok(tower.c1Engineer.get(`/v1/packages/${created}`), 200)).json();
        expect(pkg.items.map((i: { title: string }) => i.title).sort()).toEqual(["Basins", "Taps"]);
        const opened = (await ok(tower.c1Engineer.get(`/v1/packages/${open.id}`), 200)).json();
        expect(opened.items.map((i: { title: string }) => i.title)).toContain("Cable trays");
        const doors = record.rows.find((r) => r.rowNo === 6)!;
        expect((await detail(tower.c1Engineer, doors.workItemId!)).package ?? null).toBeNull();
      });

      it("RP-589-1: gives C2, K1 and the Owner nothing of the new Packages: the plain 404, and none listed", async () => {
        for (const [who, by] of [
          ["C2", c2Engineer],
          ["K1 manager", tower.k1Manager],
          ["K1 engineer", k1Engineer],
          ["Owner", ownerPm],
        ] as const) {
          for (const id of [created, open.id]) await expectHidden(by.get(`/v1/packages/${id}`), `${who} reads ${id}`);
          const listedPackages = (await ok(by.get(`/v1/projects/${tower.projectId}/packages`), 200)).json().packages.map((p: { id: string }) => p.id);
          expect(listedPackages, who).not.toContain(created);
          expect(listedPackages, who).not.toContain(open.id);
        }
      });
    });
  });

  it("puts every row in one new Package, or one Open Package of the Company; never another Company's", async () => {
    const mapping: RegisterImportMapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 } };
    const whole = await preview(tower.c1Engineer, { ...packageRegister, mapping: { ...mapping, packages: { new: "Whole register" } } });
    expect(whole.packages).toEqual([{ package: null, newName: "Whole register", rows: 5 }]);
    const into = await preview(tower.c1Engineer, { ...packageRegister, mapping: { ...mapping, packages: { existing: open.id } } });
    expect(into.packages).toEqual([{ package: expect.objectContaining({ id: open.id }), newName: null, rows: 5 }]);
    const intoStarted = await preview(tower.c1Engineer, { ...packageRegister, mapping: { ...mapping, packages: { existing: started.id } } });
    expect(intoStarted.rows.every((r) => r.reasons.includes("package_not_open"))).toBe(true);
    for (const id of [theirs.id, randomUUID()]) {
      const res = await tryPreview(tower.c1Engineer, { ...packageRegister, mapping: { ...mapping, packages: { existing: id } } });
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: { error: "package_not_found" } });
    }
    // A name chosen by hand for another Company's Package is refused alike.
    const chosen = await tryPreview(tower.c1Engineer, { ...packageRegister, mapping: { ...byPackage, values: { package: { bathrooms: theirs.id } } } });
    expect(chosen.json()).toEqual({ error: "package_not_found" });
  });

  it("lets a name matching an Open Package start a new one instead, chosen by hand", async () => {
    const previewed = await preview(tower.c1Engineer, { ...packageRegister, mapping: { ...byPackage, values: { package: { electricallevel1: "new" } } } });
    expect(packageOf(previewed, 4)).toEqual({ text: "electrical level 1", match: null, new: "electrical level 1" });
  });

  describe("the original register", () => {
    let imported: RegisterImport;

    beforeAll(async () => {
      const previewed = await preview(tower.c1Engineer, register);
      await ok(confirm(tower.c1Engineer, previewed.id), 200);
      imported = (await ok(getImport(tower.c1Engineer, previewed.id), 200)).json();
    });

    it("is downloaded by C1's Members as uploaded, named as uploaded, with no time in any header", async () => {
      expect(imported.original).toBe(true);
      for (const by of [tower.c1Engineer, tower.c1Pm]) {
        const res = await ok(by.get(`/v1/register-imports/${imported.id}/original`), 200);
        expect(res.rawPayload.equals(Buffer.from(xlsx.content, "base64"))).toBe(true);
        expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        expect(res.headers["content-disposition"]).toBe(`attachment; filename="import-register.xlsx"; filename*=UTF-8''import-register.xlsx`);
        // No import or upload time: only the response's own Date.
        for (const header of ["last-modified", "etag", "expires", "x-amz-meta-uploaded"]) expect(res.headers[header], header).toBeUndefined();
        const { date, ...rest } = res.headers;
        expect(date).toBeDefined();
        expect(JSON.stringify(rest)).not.toMatch(/\d{4}-\d{2}-\d{2}|GMT|\d{2}:\d{2}/);
      }
    });

    it("is the plain 404 to C2, K1 and the Owner, and for an Engineer's import, which keeps none", async () => {
      for (const by of [c2Engineer, tower.k1Manager, k1Engineer, ownerPm]) await expectHidden(by.get(`/v1/register-imports/${imported.id}/original`));
      await expectHidden(tower.c1Engineer.get(`/v1/register-imports/${randomUUID()}/original`));
      const defaultMember = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"]);
      const done = await api.engineerImport({
        for: { projectId: tower.projectId, participantId: tower.c1ParticipantId, defaultMemberId: defaultMember.id, reason: "Onboarding C1, original" },
        ...register,
      });
      expect((await ok(getImport(defaultMember.caller, done.importId), 200)).json().original).toBe(false);
      await expectHidden(defaultMember.caller.get(`/v1/register-imports/${done.importId}/original`));
    });

    it("keeps a preview's file to its importer", async () => {
      const previewed = await preview(tower.c1Engineer, register);
      await ok(tower.c1Engineer.get(`/v1/register-imports/${previewed.id}/original`), 200);
      await expectHidden(tower.c1Pm.get(`/v1/register-imports/${previewed.id}/original`));
    });
  });

  describe("saved mappings", () => {
    const save = (by: Caller, name: string, mapping: RegisterImportMapping = byPackage) =>
      by.post(`/v1/projects/${tower.projectId}/register-import-mappings`, { name, mapping });

    it("are saved for the Company, offered to its Members with the mapping as saved, and to no other Company", async () => {
      const saved = (await ok(save(tower.c1Engineer, "Monthly register"), 201)).json();
      expect(saved.mappings).toEqual([{ id: expect.any(String), name: "Monthly register", mapping: byPackage }]);
      expect((await fields(tower.c1Pm)).mappings).toEqual(saved.mappings);
      for (const by of [c2Engineer]) expect((await fields(by)).mappings.map((m) => m.name)).not.toContain("Monthly register");
      for (const by of [c2Engineer, ownerPm, tower.k1Manager]) {
        await expectHidden(by.request("PUT", `/v1/register-import-mappings/${saved.mappings[0].id}`, { name: "Taken over" }));
        await expectHidden(by.request("DELETE", `/v1/register-import-mappings/${saved.mappings[0].id}`));
      }
      // No time, nor who saved it.
      expect(JSON.stringify(saved)).not.toMatch(/createdAt|created_at|createdBy|savedAt/);
    });

    it("refuse a name the Company already uses, whatever its case; are renamed and deleted by its Members", async () => {
      const res = await save(tower.c1Pm, "monthly REGISTER");
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "name_taken" } });
      const id = (await ok(save(tower.c1Pm, "Long-lead items"), 201)).json().mappings.find((m: { name: string }) => m.name === "Long-lead items").id;
      const renamed = (await ok(tower.c1Engineer.request("PUT", `/v1/register-import-mappings/${id}`, { name: "Long lead" }), 200)).json();
      expect(renamed.mappings.map((m: { name: string }) => m.name)).toEqual(["Long lead", "Monthly register"]);
      const deleted = (await ok(tower.c1Engineer.request("DELETE", `/v1/register-import-mappings/${id}`), 200)).json();
      expect(deleted.mappings.map((m: { name: string }) => m.name)).toEqual(["Monthly register"]);
      await expectHidden(tower.c1Engineer.request("DELETE", `/v1/register-import-mappings/${id}`));
    });
  });
});

// Story 32: the Imports page is every Member's of the importing Company, one who may not
// import (story 4) included, each import with the Packages it created and added to (RP-657).
// Confirming an import that creates a Package tells nobody either (owner, 2026-10-19).
describe("The Imports page and its Packages (story 32, RP-657)", () => {
  let at: Tower;
  /** A C1 Member on the Project with no Position: may raise no Submittals Type there, so may not import. */
  let noCreate: Awaited<ReturnType<typeof memberOnProject>>;
  let lobby: { id: string; number: string };
  let record: RegisterImport;
  /** The outbox rows and notifications of the Project the confirm wrote. */
  let outboxOfConfirm: { kind: string }[];
  let notifiedOfConfirm: { member_id: string }[];

  const imports = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}/register-imports`), 200)).json().imports;

  beforeAll(async () => {
    const c1Co = await api.projectCreator();
    const k1Co = await api.authorizedPerson();
    at = await buildTower(api, { c1: c1Co, k1: k1Co }, "IML");
    noCreate = await memberOnProject(api, c1Co, at.c1ParticipantId, [], { name: "Rana No Create" });
    // C1's Submittals Types run here on the Snag's Workflow, whose Draft its raiser holds with
    // the Create Function Permission (RP-622): a Member with no Position may raise none of them.
    await sql`
      insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id)
      select ${at.projectId}::uuid, t.id, ${at.c1ParticipantId}::uuid,
        (select s.workflow_definition_id from work_item_type s where s.owner_kind = 'rabaed' and s.code = 'SNG')
      from work_item_type t where t.owner_kind = 'rabaed' and t.module_key = 'submittals'
    `.execute(migrator);
    lobby = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/packages`, { name: bilingual("Lobby") }), 201)).json();
    const file = {
      fileName: "Story 32.csv",
      content: Buffer.from(["Subject,Type,Trade,Package", "Basins,MAR,Electrical,Bathrooms", "Doors,MAR,Electrical,lobby", "Fans,MAR,Nowhere,Bathrooms"].join("\n")).toString(
        "base64",
      ),
    };
    const mapping: RegisterImportMapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 }, package: { column: 3 } };
    const previewed: RegisterImport = (await ok(tryPreview(at.c1Engineer, { file, sheet: "Story 32", headerRow: 1, mapping }, at.projectId), 201)).json();
    const outbox = async () => (await sql<{ id: string; kind: string }>`select id, kind from outbox where project_id = ${at.projectId}::uuid`.execute(migrator)).rows;
    const notified = async () =>
      (await sql<{ id: string; member_id: string }>`select id, member_id from notification where project_id = ${at.projectId}::uuid`.execute(migrator)).rows;
    const outboxBefore = new Set((await outbox()).map((o) => o.id));
    const notifiedBefore = new Set((await notified()).map((n) => n.id));
    expect((await ok(confirm(at.c1Engineer, previewed.id), 200)).json()).toEqual({ rowsCreated: 2 });
    outboxOfConfirm = (await outbox()).filter((o) => !outboxBefore.has(o.id)).map(({ kind }) => ({ kind }));
    notifiedOfConfirm = (await notified()).filter((n) => !notifiedBefore.has(n.id)).map(({ member_id }) => ({ member_id }));
    record = (await ok(getImport(at.c1Engineer, previewed.id), 200)).json();
  });

  it("lists each import to every C1 Member, one who may not import included, with the Packages it created and added to", async () => {
    const bathrooms = record.packages.find((p) => p.newName === "Bathrooms")!.package!;
    expect((await read(noCreate.caller, { file: xlsx }, at.projectId)).statusCode).toBe(403);
    for (const by of [at.c1Engineer, at.c1Pm, noCreate.caller]) {
      expect(await imports(by)).toEqual([
        {
          id: record.id,
          fileName: "Story 32.csv",
          status: "created",
          runBy: expect.objectContaining({ id: expect.any(String) }),
          rowsTotal: 3,
          rowsRejected: 1,
          rowsCreated: 2,
          // By number: the Open one it added to, then the new one.
          packages: [
            { id: lobby.id, number: lobby.number, name: bilingual("Lobby"), status: "open" },
            { id: bathrooms.id, number: bathrooms.number, name: bilingual("Bathrooms"), status: "open" },
          ],
        },
      ]);
      expect((await ok(getImport(by, record.id), 200)).json().packages).toHaveLength(2);
    }
    expect(await imports(at.k1Manager)).toEqual([]);
  });

  it("tells nobody of the import or the Package it created: no outbox row, no notification", () => {
    expect(outboxOfConfirm).toEqual([]);
    expect(notifiedOfConfirm).toEqual([]);
  });
});

// RP-960 (the gap RP-657 found): a Rabaed Type whose own Workflow is another Project's (only a
// migrator can make one, as apps/api/test/outcome-sets.test.ts does) is raised by nobody on
// this Project: "+ New" doesn't offer it, so neither does the import, and a row naming it is
// a Type the importer may not raise. The foreign Project (RP-1016, ./support/foreign-project.ts) is
// built before any call, with its own Type, Trade "Electrical" and Location "Building A" too.
describe("The Types a register may name are the ones \"+ New\" offers (RP-960)", () => {
  let foreign: ForeignProject;
  /** A Rabaed Type whose own Workflow is the other Project's, published. */
  let lent: string;

  beforeAll(async () => {
    foreign = await buildForeignProject(api, migrator, { code: "ORW" });
    lent = foreign.lentType;
  });

  it("offers the importer the Types \"+ New\" offers them, none on another Project's Workflow, nor that Project's own", async () => {
    const raisable = (await ok(tower.c1Engineer.get(`/v1/projects/${tower.projectId}/raisable-types`), 200)).json().types.map((t: { code: string }) => t.code);
    const fields: RegisterImportFields = (await ok(tower.c1Engineer.get(`/v1/projects/${tower.projectId}/register-imports/fields`), 200)).json();
    expect(raisable).not.toContain(lent);
    expect(fields.types.map((t) => t.code)).not.toContain(lent);
    expect(fields.types.map((t) => t.code).sort()).toEqual([...raisable].sort());
    const seen = JSON.stringify(fields);
    for (const id of [foreign.ownType, foreign.projectId, foreign.electrical, foreign.buildingA, foreign.workflowId, foreign.formId]) expect(seen).not.toContain(id);
  });

  it("refuses a row naming it as a Type the importer may not raise, and the other Project's own as unknown; its Trade and Location match nothing", async () => {
    const rows = [`Panels,${lent},Electrical,Building A`, "Pumps,MAR,Electrical,Building A", `Doors,${foreign.ownType},Electrical,Building A`];
    const file = { fileName: "Lent.csv", content: Buffer.from(["Subject,Type,Trade,Location", ...rows].join("\r\n")).toString("base64") };
    const mapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 }, location: { column: 3 } };
    const previewed = await preview(tower.c1Engineer, { file, sheet: "Lent", headerRow: 1, mapping });
    expect(reasonsByRow(previewed)).toEqual({ 2: ["type_not_allowed"], 3: [], 4: ["type_unknown"] });
    // "Electrical" and "Building A" are the foreign Project's codes and names too: only this Project's match.
    expect(previewed.rows.map((r) => [r.trade.match?.id, r.location.match?.id])).toEqual(rows.map(() => [tower.electrical, tower.buildingA]));
  });
});
