// Seam 1: the Submittal Register Import tracer (RP-637, spec RP-631; visibility.md
// RP-589-1). A Member of C1 uploads a register (.xlsx or .csv), picks the sheet and
// its header row, maps Subject, Type and Trade (from columns, or one Type and one
// Trade for the file), previews every row with every reason a bad one is bad, and
// confirms: a Draft for every good row, raised by them, and none for the bad. Only
// C1's Members read the import; C2, K1 and the Owner read nothing of it.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RegisterImport, RegisterImportMapping, RegisterSheet, WorkItemDetail } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, memberOnProject, ok, only, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

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
