// Seam 1: the Submittal Register Import tracer (RP-637, spec RP-631; visibility.md
// RP-589-1). A Member of C1 uploads a register (.xlsx or .csv), picks the sheet and
// its header row, maps Subject, Type and Trade (from columns, or one Type and one
// Trade for the file), previews every row with every reason a bad one is bad, and
// confirms: a Draft for every good row, raised by them, and none for the bad. Only
// C1's Members read the import; C2, K1 and the Owner read nothing of it.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDb, notificationDigestHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type {
  NotificationDigest,
  RegisterImport,
  RegisterImportFields,
  RegisterImportMapping,
  RegisterSheet,
  RegisterValues,
  WorkItemDetail,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    const draftOf = (subject: string) => record.rows.find((r) => r.subject === subject)!.workItemId!;

    beforeAll(async () => {
      expect((await ok(confirm(at.c1Pm, previewed.id), 200)).json()).toEqual({ rowsCreated: 3 });
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

    it("tells each assignee but the importer once how many Drafts were imported for them, and nobody else", async () => {
      const ofKind = async (by: Caller) => (await notifications(by)).filter((n) => n.kind === "drafts_imported");
      expect(await ofKind(narrowed.caller)).toEqual([expect.objectContaining({ kind: "drafts_imported", drafts: { count: 2, projectId: at.projectId }, readAt: null })]);
      expect(await ofKind(colleague.caller)).toEqual([expect.objectContaining({ drafts: { count: 1, projectId: at.projectId } })]);
      for (const by of [at.c1Pm, noCreate.caller, k1Person.caller, at.k1Manager]) expect(await ofKind(by)).toEqual([]);
    });

    it("shows no time on the notification: when Drafts were imported is when they were started (scenario 61)", async () => {
      const [n] = (await notifications(narrowed.caller)).filter((x) => x.kind === "drafts_imported");
      expect(n!.createdAt).toBeNull();
    });

    it("routes it like any other notification: a digest by default", async () => {
      const digests: NotificationDigest[] = [];
      await worker.transaction().execute((trx) => sql`select app.enqueue_notification_digests()`.execute(trx));
      await drainOutbox(worker, { digest: notificationDigestHandler(async (d) => void digests.push(d)) });
      const entries = digests.filter((d) => d.to === narrowed.email).flatMap((d) => d.projects.flatMap((p) => p.items.flatMap((i) => i.entries)));
      expect(entries).toEqual([expect.objectContaining({ kind: "drafts_imported", drafts: { count: 2 } })]);
    });
  });
});
