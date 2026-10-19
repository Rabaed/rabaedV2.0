// Seam: Rabaed Admin as a signed-in Rabaed Engineer (RP-645, spec RP-631 stories 38–41;
// visibility.md RP-589-3). The Engineer imports C1's register for C1's Participant: picks the
// Project, the Participant and a default Member of it who raises every row nobody else is
// assigned, gives a reason, and runs the customer api's own import (the same checks as a
// Member's import), logged as admin_action with the reason. C1's Members read "Rabaed" as the
// importer, never the Engineer, and no time; K1 reads nothing (seam 1 has the rest:
// apps/api/test/register-import.test.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { AdminRegisterImportParticipants, AdminRegisterImportProjects, RegisterImport, RegisterImportFields, RegisterImportMapping, RegisterSheet } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden } from "../../api/test/support/harness.ts";
import { bilingual, buildTower, memberOnProject, ok, only, type Tower } from "../../api/test/support/tower.ts";
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
  const c1 = await api.projectCreator();
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
      ["defaultRaiser", "fileName", "headerRow", "headers", "id", "mapping", "projectId", "rows", "rowsCreated", "rowsRejected", "rowsTotal", "runBy", "sheet", "status"].sort(),
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
