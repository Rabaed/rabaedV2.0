// Seam: Rabaed Admin as a signed-in Rabaed Engineer (RP-645, spec RP-631 stories 38–41;
// visibility.md RP-589-3). The Engineer imports C1's register for C1's Participant: picks the
// Project, the Participant and a default Member of it who raises every row nobody else is
// assigned, gives a reason, and runs the customer api's own import (the same checks as a
// Member's import), logged as admin_action with the reason. C1's Members read "Rabaed" as the
// importer, never the Engineer, and no time; K1 reads nothing (seam 1 has the rest:
// apps/api/test/register-import.test.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type {
  AdminRegisterImportParticipants,
  AdminRegisterImportProjects,
  RegisterImport,
  RegisterImportFields,
  RegisterImportMapping,
  RegisterSheet,
  RegisterValues,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden } from "../../api/test/support/harness.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, type Company, type Tower } from "../../api/test/support/tower.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const api = await createTestApi();
const admin = await createTestAdmin();
// Reads the audit trail and the outbox directly.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await api.close();
  await adminDb.destroy();
});

type Person = Awaited<ReturnType<typeof memberOnProject>>;
const reason = "TMC asked for help loading their Rev 4 register, ticket #4821";

let tower: Tower;
let c1: Company;
let k1ParticipantId: string;
/** The default Member: raises every row nobody else is assigned. */
let hafiz: Person;
/** A C1 engineer whose Trade Visibility is Electrical only. */
let narrowed: Person;
let k1Person: Person;
let engineer: { id: string; email: string; browser: Browser };

const csvOf = (rows: string[][]) => ({
  fileName: "TMC_Register_Rev4.csv",
  content: Buffer.from(["Subject,Type,Trade,Assign to", ...rows.map((r) => r.join(","))].join("\r\n")).toString("base64"),
});
const reasonsByRow = (preview: RegisterImport) => Object.fromEntries(preview.rows.map((r) => [r.rowNo, r.reasons]));
const actionsOf = async (engineerId: string) =>
  adminDb.selectFrom("admin_action").select(["action", "target_kind", "target_id", "reason", "after"]).where("engineer_id", "=", engineerId).orderBy("at").execute();

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "ADM");
  k1ParticipantId = (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { projectRole: { baseRole: string } }) => p.projectRole.baseRole === "consultant").id;
  hafiz = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: "Hafiz Default" });
  narrowed = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { trade: only(tower.electrical), name: "Faisal Narrowed" });
  k1Person = await memberOnProject(api, k1, k1ParticipantId, ["engineer"]);
  engineer = await admin.signedInEngineer();
});

describe("Company & reason", () => {
  it("lists the active Projects, then a Project's Participants with their Members and who may import, each read logged with its reason", async () => {
    const projects: AdminRegisterImportProjects = (await ok(engineer.browser.get(`/v1/register-imports/projects?reason=${encodeURIComponent(reason)}`), 200)).json();
    expect(projects.projects.map((p) => p.id)).toContain(tower.projectId);

    const url = `/v1/register-imports/projects/${tower.projectId}/participants?reason=${encodeURIComponent(reason)}`;
    const { participants }: AdminRegisterImportParticipants = (await ok(engineer.browser.get(url), 200)).json();
    const c1 = participants.find((p) => p.id === tower.c1ParticipantId)!;
    const k1 = participants.find((p) => p.id === k1ParticipantId)!;
    // A Consultant raises no Submittals: none of K1's Members may import.
    expect([c1.mayImport, k1.mayImport]).toEqual([true, false]);
    expect(c1.members.find((m) => m.id === hafiz.id)).toEqual({ id: hafiz.id, name: bilingual("Hafiz Default"), email: hafiz.email, mayImport: true });
    expect(k1.members.map((m) => m.id)).toContain(k1Person.id);

    const actions = await actionsOf(engineer.id);
    expect(actions.map((a) => [a.action, a.target_kind, a.target_id, a.reason])).toEqual([
      ["read_register_import", "project", null, reason],
      ["read_register_import", "project", tower.projectId, reason],
    ]);
  });

  it("needs a reason, and a signed-in Engineer", async () => {
    expect((await engineer.browser.get("/v1/register-imports/projects")).statusCode).toBe(400);
    expect((await engineer.browser.get(`/v1/register-imports/projects/${tower.projectId}/participants?reason=%20`)).statusCode).toBe(400);
    expect((await admin.browser().get(`/v1/register-imports/projects?reason=${encodeURIComponent(reason)}`)).statusCode).toBe(401);
  });
});

describe("An Engineer's import for C1", () => {
  const forC1 = () => ({ projectId: tower.projectId, participantId: tower.c1ParticipantId, defaultMemberId: hafiz.id, reason });
  const file = () =>
    csvOf([
      ["Panels", "MAR", "Electrical", ""],
      ["Pumps", "MAR", "Mechanical", narrowed?.email ?? ""],
      ["Fans", "SAR", "Electrical", ""],
      ["Doors", "MAR", "Mechanical", ""],
      ["Railings", "MAR", "Electrical", k1Person?.email ?? ""],
      ["", "MAR", "Electrical", ""],
    ]);
  const mapping = (): RegisterImportMapping => ({
    subject: { column: 0 },
    type: { column: 1 },
    trade: { column: 2 },
    assignTo: { column: 3 },
    assign: { rules: [{ by: "type", value: "SAR", member: narrowed.id }] },
  });
  const request = () => ({ for: forC1(), file: file(), sheet: "TMC_Register_Rev4", headerRow: 1, mapping: mapping() });
  let previewed: RegisterImport;

  beforeAll(async () => {
    previewed = (await ok(engineer.browser.post("/v1/register-imports", request()), 201)).json();
  });

  it("reads the register and what it may fill as the default Member would", async () => {
    const sheet: RegisterSheet = (await ok(engineer.browser.post("/v1/register-imports/read", { for: forC1(), file: file() }), 200)).json();
    expect(sheet.suggestions.map((s) => s?.field ?? null)).toEqual(["subject", "type", "trade", "assignTo"]);
    const fields: RegisterImportFields = (await ok(engineer.browser.post("/v1/register-imports/fields", { for: forC1() }), 200)).json();
    // Whom rows may be assigned to: C1's own Members on the Project, and nobody else.
    expect(fields.members.map((m) => m.id)).toEqual(expect.arrayContaining([hafiz.id, narrowed.id]));
    expect(fields.members.map((m) => m.id)).not.toContain(k1Person.id);
    expect(fields.types.map((t) => t.code)).toEqual(expect.arrayContaining(["MAR", "SAR"]));
  });

  it("checks every row as a Member's import is checked, the default Member in the importer's place, \"Assign to\" overriding it", () => {
    expect(previewed).toMatchObject({ status: "previewed", fileName: "TMC_Register_Rev4.csv", rowsTotal: 6, rowsRejected: 3, runBy: null });
    expect(previewed.defaultRaiser).toEqual({ id: hafiz.id, name: bilingual("Hafiz Default") });
    expect(reasonsByRow(previewed)).toEqual({
      2: [],
      3: ["assignee_outside_visibility"],
      4: [],
      5: [],
      6: ["assignee_unknown"],
      7: ["subject_missing"],
    });
    const assignee = Object.fromEntries(previewed.rows.map((r) => [r.subject, r.assignee.match?.id ?? null]));
    // The default Member raises what nobody else is assigned, as the importer would.
    expect(assignee).toMatchObject({ Panels: null, Fans: narrowed.id, Doors: null });
  });

  it("shows no time of the import, nor anyone's but the Company's own Members", () => {
    expect(Object.keys(previewed).sort()).toEqual(
      [
        "defaultRaiser",
        "fileName",
        "headerRow",
        "headers",
        "id",
        "mapping",
        "original",
        "packages",
        "projectId",
        "rows",
        "rowsCreated",
        "rowsRejected",
        "rowsTotal",
        "runBy",
        "sheet",
        "status",
      ].sort(),
    );
  });

  it("refuses a default Member who isn't an active Member of the Participant, or may not import there, and logs nothing", async () => {
    const before = (await actionsOf(engineer.id)).length;
    const other = await engineer.browser.post("/v1/register-imports", { ...request(), for: { ...forC1(), defaultMemberId: k1Person.id } });
    expect({ status: other.statusCode, body: other.json() }).toEqual({ status: 422, body: { error: "default_member_not_found" } });
    const consultant = await engineer.browser.post("/v1/register-imports", { ...request(), for: { ...forC1(), participantId: k1ParticipantId, defaultMemberId: k1Person.id } });
    expect({ status: consultant.statusCode, body: consultant.json() }).toEqual({ status: 403, body: { error: "forbidden" } });
    expect((await actionsOf(engineer.id)).length).toBe(before);
  });

  it("needs a default Member and a reason", async () => {
    const { defaultMemberId: _default, ...noDefault } = forC1();
    expect((await engineer.browser.post("/v1/register-imports", { ...request(), for: noDefault })).statusCode).toBe(400);
    expect((await engineer.browser.post("/v1/register-imports", { ...request(), for: { ...forC1(), reason: " " } })).statusCode).toBe(400);
  });

  it("keeps the preview the Engineer's own: not the default Member's, nor another Engineer's", async () => {
    await expectHidden(hafiz.caller.get(`/v1/register-imports/${previewed.id}`));
    await expectHidden(hafiz.caller.post(`/v1/register-imports/${previewed.id}/confirm`, {}));
    const other = await admin.signedInEngineer();
    expect((await other.browser.get(`/v1/register-imports/${previewed.id}?reason=${encodeURIComponent(reason)}`)).statusCode).toBe(404);
    expect((await other.browser.post(`/v1/register-imports/${previewed.id}/confirm`, { reason })).json()).toEqual({ error: "not_found" });
  });

  describe("on confirm", () => {
    let record: RegisterImport;
    let outboxBefore: Set<string>;
    const draftOf = (subject: string) => record.rows.find((r) => r.subject === subject)!.workItemId!;
    const needMyAction = async (by: Person) =>
      ((await ok(by.caller.get(`/v1/projects/${tower.projectId}/work-items?needMyAction=true`), 200)).json().items as { id: string }[]).map((i) => i.id);

    beforeAll(async () => {
      outboxBefore = new Set((await sql<{ id: string }>`select id from outbox where project_id = ${tower.projectId}::uuid`.execute(adminDb)).rows.map((r) => r.id));
      expect((await ok(engineer.browser.post(`/v1/register-imports/${previewed.id}/confirm`, { reason }), 200)).json()).toEqual({ rowsCreated: 3 });
      record = (await ok(engineer.browser.get(`/v1/register-imports/${previewed.id}?reason=${encodeURIComponent(reason)}`), 200)).json();
    });

    it("creates the good rows' Drafts, each raised by the default Member or its assignee as their own", async () => {
      expect(record.rows.filter((r) => r.created).map((r) => r.subject)).toEqual(["Panels", "Fans", "Doors"]);
      expect((await needMyAction(hafiz)).sort()).toEqual([draftOf("Panels"), draftOf("Doors")].sort());
      expect(await needMyAction(narrowed)).toEqual([draftOf("Fans")]);
    });

    it("logs the preview and the confirm as admin_action with the reason, whom it was for, and no time", async () => {
      const actions = (await actionsOf(engineer.id)).filter((a) => a.target_id === previewed.id && a.action !== "read_register_import");
      expect(actions).toEqual([
        {
          action: "preview_register_import",
          target_kind: "submittal_register_import",
          target_id: previewed.id,
          reason,
          after: { participantId: tower.c1ParticipantId, defaultMemberId: hafiz.id, outcome: "previewed" },
        },
        { action: "confirm_register_import", target_kind: "submittal_register_import", target_id: previewed.id, reason, after: { rowsCreated: 3 } },
      ]);
    });

    it("RP-589-3: C1's Members read \"Rabaed\" as the importer, never the Engineer, and no time", async () => {
      for (const by of [hafiz.caller, tower.c1Pm]) {
        const listed = (await ok(by.get(`/v1/projects/${tower.projectId}/register-imports`), 200)).json().imports;
        expect(listed.find((i: { id: string }) => i.id === previewed.id)).toEqual({
          id: previewed.id,
          fileName: "TMC_Register_Rev4.csv",
          status: "created",
          runBy: null,
          rowsTotal: 6,
          rowsRejected: 3,
          rowsCreated: 3,
        });
        const seen = (await ok(by.get(`/v1/register-imports/${previewed.id}`), 200)).body;
        expect(seen).not.toContain(engineer.email);
        expect(seen).not.toContain("Test Engineer");
        expect(JSON.parse(seen).runBy).toBeNull();
      }
    });

    it("RP-589-3: K1 reads nothing of it", async () => {
      await expectHidden(k1Person.caller.get(`/v1/register-imports/${previewed.id}`));
      expect((await ok(k1Person.caller.get(`/v1/projects/${tower.projectId}/register-imports`), 200)).json().imports).toEqual([]);
      for (const id of [draftOf("Panels"), draftOf("Fans")]) await expectHidden(k1Person.caller.get(`/v1/work-items/${id}`));
    });

    it("tells nobody: the confirm writes no outbox row", async () => {
      const after = (await sql<{ id: string }>`select id from outbox where project_id = ${tower.projectId}::uuid`.execute(adminDb)).rows;
      expect(after.filter((r) => !outboxBefore.has(r.id))).toEqual([]);
    });
  });
});

// Rabaed Admin connects as rabaed_admin, which reads past row-level security: every check of
// an Engineer's import must scope to the default Member explicitly, never lean on a policy.
// Each test runs the same import as the default Member through the customer api (rabaed_app,
// through row-level security) and expects the same answer.
describe("An Engineer's import checks as the default Member, past row-level security", () => {
  /** C1's default Member here: Electrical only, and Building A only. */
  let nadia: Person;
  /** A C1 engineer who sees Mechanical only. */
  let mona: Person;
  /** C2, a second Contractor on the Project. */
  let c2Engineer: Person;
  let c2Item: string;
  const c2Title = "C2 cable trays";

  const forNadia = () => ({ projectId: tower.projectId, participantId: tower.c1ParticipantId, defaultMemberId: nadia.id, reason });
  const header = "Subject,Type,Trade,Location,Paper ref,Assign to";
  const file = () => ({
    fileName: "C1_Register_Narrowed.csv",
    content: Buffer.from(
      [
        header,
        "Cables,MAR,Electrical,Building A,,",
        "Pumps,MAR,Mechanical,Building A,,",
        "Lights,MAR,Electrical,Building B,,",
        "Trays,MAR,Electrical,Building A,C2-REF-1,",
        "Conduits,MAR,Electrical,Building A,c1-ref-1,",
        `Boxes,MAR,Electrical,Building A,,${c2Engineer.email}`,
        `Glands,MAR,Electrical,Building A,,${k1Person.email}`,
        `Sockets,MAR,Electrical,Building A,,${mona.email}`,
        "Fans,SAR,Electrical,Building A,,",
      ].join("\r\n"),
    ).toString("base64"),
  });
  const mapping = (): RegisterImportMapping => ({
    subject: { column: 0 },
    type: { column: 1 },
    trade: { column: 2 },
    location: { column: 3 },
    paperRef: { column: 4 },
    assignTo: { column: 5 },
    // Another Participant's Member, picked by id.
    assign: { rules: [{ by: "type", value: "SAR", member: c2Engineer.id }] },
  });
  const upload = () => ({ file: file(), sheet: "C1_Register_Narrowed", headerRow: 1, mapping: mapping() });
  const projectUrl = (path: string) => `/v1/projects/${tower.projectId}/${path}`;
  const setRef = (by: Person["caller"], id: string, paperRef: string) => ok(by.request("PUT", `/v1/work-items/${id}/paper-ref`, { paperRef }));
  const dar = async (by: Person["caller"], title: string) =>
    (await ok(by.post(projectUrl("work-items"), { type: "DAR", title, answers: { trade: tower.electrical } }), 201)).json().id as string;

  let previewed: RegisterImport;
  let asMember: RegisterImport;

  beforeAll(async () => {
    const buildingB = (await ok(c1.caller.post(projectUrl("locations"), { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
    expect(buildingB).toBeTruthy();
    nadia = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { trade: only(tower.electrical), name: "Nadia Narrowed" });
    await ok(c1.caller.request("PUT", `/v1/participants/${tower.c1ParticipantId}/members/${nadia.id}/visibility`, { trade: only(tower.electrical), location: only(tower.buildingA) }));
    mona = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { trade: only(tower.mechanical), name: "Mona Mechanical" });

    const onboarded = await api.onboardCompany({ legalName: bilingual("C2 Contracting") });
    const c2: Company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
    const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
    c2Engineer = await memberOnProject(api, c2, c2ParticipantId, ["engineer"]);
    // C2's own Draft holds C2-REF-1; C1's own holds C1-REF-1.
    c2Item = await dar(c2Engineer.caller, c2Title);
    await setRef(c2Engineer.caller, c2Item, "C2-REF-1");
    await setRef(tower.c1Engineer, await dar(tower.c1Engineer, "C1 conduits"), "C1-REF-1");

    previewed = (await ok(engineer.browser.post("/v1/register-imports", { for: forNadia(), ...upload() }), 201)).json();
    asMember = (await ok(nadia.caller.post(projectUrl("register-imports"), upload()), 201)).json();
  });

  it("refuses a row outside the default Member's Trade or Location Visibility with the reason a Member's import gives", () => {
    expect(reasonsByRow(previewed)).toMatchObject({ 2: [], 3: ["trade_outside_visibility"], 4: ["location_outside_visibility"] });
    expect(reasonsByRow(previewed)).toEqual(reasonsByRow(asMember));
  });

  it("refuses a Paper ref C1's own Work Item holds; one another Participant's holds neither refuses the row nor shows anything of it", () => {
    expect(reasonsByRow(previewed)).toMatchObject({ 5: [], 6: ["paper_ref_taken"] });
    const seen = JSON.stringify(previewed);
    expect(seen).not.toContain(c2Item);
    expect(seen).not.toContain(c2Title);
  });

  it("refuses \"Assign to\" naming another Participant's Member, by email or picked by id, and a C1 Member who doesn't see the row's Trade", () => {
    expect(reasonsByRow(previewed)).toMatchObject({
      7: ["assignee_unknown"],
      8: ["assignee_unknown"],
      9: ["assignee_outside_visibility"],
      10: ["assignee_unknown"],
    });
    // Only C1's own Member is matched; the others read as nobody.
    expect(previewed.rows.flatMap((r) => (r.assignee.match ? [r.assignee.match.id] : []))).toEqual([mona.id]);
  });

  it("offers the fields and values the default Member is offered through the customer api: no other Participant's Members", async () => {
    const fields: RegisterImportFields = (await ok(engineer.browser.post("/v1/register-imports/fields", { for: forNadia() }), 200)).json();
    const theirFields: RegisterImportFields = (await ok(nadia.caller.get(projectUrl("register-imports/fields")), 200)).json();
    expect(fields).toEqual(theirFields);
    expect(fields.members.map((m) => m.id)).toEqual(expect.arrayContaining([nadia.id, mona.id, hafiz.id]));
    expect(fields.members.map((m) => m.id)).not.toEqual(expect.arrayContaining([c2Engineer.id]));
    expect(fields.members.map((m) => m.id)).not.toEqual(expect.arrayContaining([k1Person.id]));

    const values: RegisterValues = (await ok(engineer.browser.post("/v1/register-imports/values", { for: forNadia(), ...upload() }), 200)).json();
    const theirValues: RegisterValues = (await ok(nadia.caller.post(projectUrl("register-imports/values"), upload()), 200)).json();
    expect(values).toEqual(theirValues);
    const assignTo = values.fields.find((f) => f.field === "assignTo")!;
    expect(assignTo.values.map((v) => [v.text, v.match])).toEqual([
      [c2Engineer.email, null],
      [k1Person.email, null],
      [mona.email, mona.id],
    ]);
  });

  describe("on confirm", () => {
    let record: RegisterImport;

    beforeAll(async () => {
      expect((await ok(engineer.browser.post(`/v1/register-imports/${previewed.id}/confirm`, { reason }), 200)).json()).toEqual({ rowsCreated: 2 });
      record = (await ok(engineer.browser.get(`/v1/register-imports/${previewed.id}?reason=${encodeURIComponent(reason)}`), 200)).json();
    });

    it("creates nothing for a refused row: only the good rows' Drafts, raised by the default Member", async () => {
      expect(record.rows.filter((r) => r.created).map((r) => r.subject)).toEqual(["Cables", "Trays"]);
      const { rows } = await sql<{ id: string }>`select id from work_item where import_id = ${previewed.id}::uuid`.execute(adminDb);
      expect(rows.map((r) => r.id).sort()).toEqual(record.rows.flatMap((r) => (r.workItemId ? [r.workItemId] : [])).sort());
      const mine = ((await ok(nadia.caller.get(`${projectUrl("work-items")}?needMyAction=true`), 200)).json().items as { id: string }[]).map((i) => i.id);
      expect(mine.sort()).toEqual(rows.map((r) => r.id).sort());
    });

    it("leaves C2 reading nothing of it, its own Paper ref untouched", async () => {
      expect((await ok(c2Engineer.caller.get(projectUrl("register-imports")), 200)).json().imports).toEqual([]);
      await expectHidden(c2Engineer.caller.get(`/v1/register-imports/${previewed.id}`));
      expect((await ok(c2Engineer.caller.get(`/v1/work-items/${c2Item}`), 200)).json().paperRef).toBe("C2-REF-1");
    });
  });

  it("reads and confirms as none once its default Member has left the Participant, as a Member's own preview does", async () => {
    const leaving = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: "Omar Leaving" });
    const one = { file: { fileName: "Leaving.csv", content: Buffer.from(`${header}\r\nCables,MAR,Electrical,Building A,,`).toString("base64") }, sheet: "Leaving", headerRow: 1, mapping: mapping() };
    const forLeaving = { ...forNadia(), defaultMemberId: leaving.id };
    const theirs: RegisterImport = (await ok(engineer.browser.post("/v1/register-imports", { for: forLeaving, ...one }), 201)).json();
    const own: RegisterImport = (await ok(leaving.caller.post(projectUrl("register-imports"), one), 201)).json();
    await ok(c1.caller.request("DELETE", `/v1/participants/${tower.c1ParticipantId}/members/${leaving.id}`));

    await expectHidden(leaving.caller.get(`/v1/register-imports/${own.id}`));
    expect((await engineer.browser.get(`/v1/register-imports/${theirs.id}?reason=${encodeURIComponent(reason)}`)).statusCode).toBe(404);
    expect((await engineer.browser.post(`/v1/register-imports/${theirs.id}/confirm`, { reason })).json()).toEqual({ error: "not_found" });
  });
});

// RP-644 past row-level security: an Engineer's import, run as C1's default Member on Rabaed
// Admin's connection, never matches, offers or adds to another Participant's Package, and
// never reads another Company's saved mappings.
describe("An Engineer's import and Packages (RP-644)", () => {
  /** C2, a second Contractor on the Project, with a Package named as a name in C1's register. */
  let c2Person: Person;
  let theirs: { id: string; number: string };
  let ours: { id: string; number: string };
  let started: { id: string; number: string };

  const forHafiz = () => ({ projectId: tower.projectId, participantId: tower.c1ParticipantId, defaultMemberId: hafiz.id, reason });
  const projectUrl = (path: string) => `/v1/projects/${tower.projectId}/${path}`;
  const createPackage = async (by: Person["caller"], name: string): Promise<{ id: string; number: string }> =>
    (await ok(by.post(projectUrl("packages"), { name: bilingual(name) }), 201)).json();
  const upload = (mapping: RegisterImportMapping) => ({
    file: {
      fileName: "TMC_Packages.csv",
      content: Buffer.from(["Subject,Type,Trade,Package", "Panels,MAR,Electrical,Shared set", "Pumps,MAR,Mechanical,C1 set", "Fans,MAR,Electrical,Started set"].join("\r\n")).toString(
        "base64",
      ),
    },
    sheet: "TMC_Packages",
    headerRow: 1,
    mapping,
  });
  const byColumn: RegisterImportMapping = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 }, package: { column: 3 } };

  beforeAll(async () => {
    const onboarded = await api.onboardCompany({ legalName: bilingual("C2 Packages") });
    const c2: Company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
    const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
    c2Person = await memberOnProject(api, c2, c2ParticipantId, ["engineer"]);
    theirs = await createPackage(c2Person.caller, "Shared set");
    ours = await createPackage(hafiz.caller, "C1 set");
    started = await createPackage(hafiz.caller, "Started set");
    await sql`update package set status = 'in_progress' where id = ${started.id}::uuid`.execute(adminDb);
    await ok(c2Person.caller.post(projectUrl("register-import-mappings"), { name: "C2 monthly", mapping: byColumn }), 201);
    await ok(hafiz.caller.post(projectUrl("register-import-mappings"), { name: "C1 monthly", mapping: byColumn }), 201);
  });

  it("offers the default Member's own Packages and saved mappings, as the customer api offers them; none of another Company's", async () => {
    const fields: RegisterImportFields = (await ok(engineer.browser.post("/v1/register-imports/fields", { for: forHafiz() }), 200)).json();
    const theirFields: RegisterImportFields = (await ok(hafiz.caller.get(projectUrl("register-imports/fields")), 200)).json();
    expect(fields.packages).toEqual(theirFields.packages);
    expect(fields.mappings).toEqual(theirFields.mappings);
    const open = fields.packages.filter((p) => p.status === "open").map((p) => p.id);
    expect(open).toContain(ours.id);
    expect(open).not.toContain(started.id);
    expect(fields.packages.map((p) => p.id)).not.toContain(theirs.id);
    expect(fields.mappings.map((m) => m.name)).toEqual(["C1 monthly"]);
  });

  it("never matches another Company's Package by name: a new one instead, as for the Member", async () => {
    const values: RegisterValues = (await ok(engineer.browser.post("/v1/register-imports/values", { for: forHafiz(), ...upload(byColumn) }), 200)).json();
    expect(values.fields.find((f) => f.field === "package")!.values.map((v) => [v.text, v.match])).toEqual([
      ["Shared set", null],
      ["C1 set", ours.id],
      ["Started set", started.id],
    ]);
    const previewed: RegisterImport = (await ok(engineer.browser.post("/v1/register-imports", { for: forHafiz(), ...upload(byColumn) }), 201)).json();
    const asMember: RegisterImport = (await ok(hafiz.caller.post(projectUrl("register-imports"), upload(byColumn)), 201)).json();
    expect(reasonsByRow(previewed)).toEqual({ 2: [], 3: [], 4: ["package_not_open"] });
    expect(reasonsByRow(previewed)).toEqual(reasonsByRow(asMember));
    expect(previewed.rows.map((r) => r.package.match?.id ?? r.package.new)).toEqual(["Shared set", ours.id, started.id]);
    expect(JSON.stringify(previewed)).not.toContain(theirs.id);
    expect(previewed.original).toBe(false);
  });

  it("refuses another Company's Package, chosen for the file or for a name, with the Member's answer, and logs nothing", async () => {
    const before = (await actionsOf(engineer.id)).length;
    for (const mapping of [
      { ...byColumn, package: undefined, packages: { existing: theirs.id } },
      { ...byColumn, values: { package: { sharedset: theirs.id } } },
    ] as RegisterImportMapping[]) {
      const res = await engineer.browser.post("/v1/register-imports", { for: forHafiz(), ...upload(mapping) });
      const member = await hafiz.caller.post(projectUrl("register-imports"), upload(mapping));
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: { error: "package_not_found" } });
      expect({ status: member.statusCode, body: member.json() }).toEqual({ status: 422, body: { error: "package_not_found" } });
    }
    // Refused by the preview itself, logged as such.
    const logged = (await actionsOf(engineer.id)).slice(before);
    expect(logged.map((a) => [a.action, (a.after as { outcome?: string }).outcome])).toEqual([
      ["preview_register_import", "package_not_found"],
      ["preview_register_import", "package_not_found"],
    ]);
  });

  it("creates its new Package for C1 on confirm, and adds nothing to C2's", async () => {
    const previewed: RegisterImport = (await ok(engineer.browser.post("/v1/register-imports", { for: forHafiz(), ...upload(byColumn) }), 201)).json();
    expect((await ok(engineer.browser.post(`/v1/register-imports/${previewed.id}/confirm`, { reason }), 200)).json()).toEqual({ rowsCreated: 2 });
    const record: RegisterImport = (await ok(engineer.browser.get(`/v1/register-imports/${previewed.id}?reason=${encodeURIComponent(reason)}`), 200)).json();
    const made = record.packages.find((p) => p.newName === "Shared set")!.package!;
    expect(made).toMatchObject({ name: bilingual("Shared set"), status: "open" });
    const pkg = (await ok(hafiz.caller.get(`/v1/packages/${made.id}`), 200)).json();
    expect(pkg.items.map((i: { title: string }) => i.title)).toEqual(["Panels"]);
    await expectHidden(c2Person.caller.get(`/v1/packages/${made.id}`));
    expect((await ok(c2Person.caller.get(`/v1/packages/${theirs.id}`), 200)).json().items).toEqual([]);
  });
});
