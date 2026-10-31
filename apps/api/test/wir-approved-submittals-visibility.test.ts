// Seam 1 for the WIR's Approved submittals and the Project setting that makes them required
// (RP-82, INSP-2; spec RP-649; visibility.md E1, V20; scenarios RP-82-1 and RP-82-2). Seam 2:
// packages/db/test/wir-approved-submittals-rls.test.ts. The Form and Link search themselves are
// in wir-form-v2.test.ts; this file is who reads what. Every "hidden" is proved with
// expectHiddenFrom: a reader who may see the row reads it first, by id (RP-1095).
//
// RP-82-1: C1's WIR in Building A names under Approved submittals a MAR closed at Code A in
// Building B; K1 handles both. K1's inspector, who covers Building A only, reads the WIR and gets
// that MAR as its Document Number and Subject, never its id, and can't open it; K1's Authorized
// Person, who covers the whole Project, gets its id. Link search offers a filler only the items
// they see, and a save naming another is refused like an unknown option.
//
// RP-82-2: which link questions Tower makes required is read by every Tower Member of every
// Participant and never by another Project's Admin, names nobody who set it, and is changed by
// Tower's Project Admin only; each Project's WIRs follow their own setting.
//
// The submittals are a test-only Type on the test Workflow with Code B (addSendBackType).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { LinkSearchResults, ProjectRequiredFields } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checklistTemplate } from "./support/checklist-template.ts";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const SUBMITTAL = "WASAP";
const requestedFor = "2026-11-02T05:30:00.000Z";

let tower: Tower;
let other: Tower; // Another Project, of another Contractor.
let buildingB = "";
let wirChecklist = "";
let k1Ap: Caller; // K1's Authorized Person, a Tower Member covering the whole Project.
let inspector: Caller; // K1's engineer, covering Building A only.
let c1Filler: Caller; // A C1 engineer covering Building A only: fills a WIR there.
let mar = ""; // C1's MAR in Building B, closed at Code A.
let wir = ""; // C1's WIR in Building A naming it under Approved submittals, Submitted to K1.

const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

/** C1's submittal in `location`, closed at Code A by K1's manager. */
async function closedAtA(title: string, location: string): Promise<string> {
  const id = (await ok(tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: SUBMITTAL, title, answers: { model: title, trade: tower.electrical, location } }), 201)).json()
    .id as string;
  await take(tower.c1Engineer, id, "send_for_review");
  await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.c1Pm, id, "submit");
  await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.k1Manager, id, "send_to_manager");
  await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.k1Manager, id, "approve_a");
  return id;
}

/** The answers of a WIR of `at`'s in Building A, Electrical. */
const wirAnswers = (at: Tower, checklist: string, extra: Record<string, unknown> = {}) => ({
  description: "Cable trays on level 3",
  requested_for: requestedFor,
  trade: at.electrical,
  location: at.buildingA,
  checklist_template: checklist,
  ...extra,
});

beforeAll(async () => {
  const exists = await migrator.selectFrom("work_item_type").select("id").where("owner_kind", "=", "rabaed").where("code", "=", SUBMITTAL).executeTakeFirst();
  if (!exists) {
    await addSendBackType(
      migrator,
      SUBMITTAL,
      { en: "Approved submittals visibility (test)", ar: "رؤية الاعتمادات (اختبار)" },
      {
        sections: [
          { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
          {
            key: "classification",
            title: bilingual("Classification"),
            fields: [
              { key: "trade", type: "trade", label: bilingual("Trade") },
              { key: "location", type: "location", label: bilingual("Location") },
              { key: "scopes", type: "scopes", label: bilingual("Scopes") },
            ],
          },
        ],
      },
      { withApproveB: true },
    );
  }
  const c1: Company = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "WSV");
  other = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "WSO");
  buildingB = (await ok(tower.admin!.post(`/v1/projects/${tower.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id as string;
  wirChecklist = await checklistTemplate(tower.admin!, tower.projectId, tower.electrical);

  const k1ParticipantId = tower.k1ParticipantId!;
  const k1ApId = k1.company.authorizedPerson.id;
  await api.addProjectMember(k1.caller, k1ParticipantId, k1ApId);
  await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${k1ApId}/visibility`, { trade: all, location: all }));
  k1Ap = k1.caller;
  const k1Inspector = await memberOnProject(api, k1, k1ParticipantId, ["engineer"]);
  await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${k1Inspector.id}/visibility`, { trade: all, location: only(tower.buildingA) }));
  inspector = k1Inspector.caller;
  const filler = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"]);
  await ok(c1.caller.request("PUT", `/v1/participants/${tower.c1ParticipantId}/members/${filler.id}/visibility`, { trade: all, location: only(tower.buildingA) }));
  c1Filler = filler.caller;
  const known: [Caller, string][] = [
    [tower.admin!, "C1 Project Admin"], [tower.c1Engineer, "C1 engineer"], [c1Filler, "C1 engineer (Building A)"], [tower.k1Manager, "K1 manager"],
    [k1Ap, "K1 Authorized Person"], [inspector, "K1 inspector (Building A)"], [other.admin!, "the other Project's Admin"],
  ];
  for (const [by, name] of known) names.set(by, name);

  mar = await closedAtA("Cable trays, Code A", buildingB);
  wir = (await ok(tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: "WIR", title: "Cable trays, level 3", answers: wirAnswers(tower, wirChecklist, { approved_submittals: [mar] }) }), 201)).json()
    .id as string;
  await take(tower.c1Engineer, wir, "send_for_review");
  await ok(tower.c1Pm.post(`/v1/work-items/${wir}/pick-up`));
  await take(tower.c1Pm, wir, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
});

describe("RP-82-1: an inspector reads an Approved submittal they can't see as its Document Number and Subject (E1)", () => {
  it("gives K1's inspector, covering Building A only, the WIR with the MAR as its number and Subject; K1's Authorized Person gets its id", async () => {
    const marNumber = (await detail(tower.c1Engineer, mar)).documentNumber!;
    expect((await detail(inspector, wir)).answers.approved_submittals).toEqual([{ documentNumber: marNumber, subject: "Cable trays, Code A" }]);
    expect((await detail(k1Ap, wir)).answers.approved_submittals).toEqual([mar]);
  });

  it("never gives the inspector the MAR's id, on the WIR's page or by opening the MAR, which K1's Authorized Person reads", async () => {
    /** [the MAR] when `by`'s read of `path` holds its id anywhere. */
    const marIdIn = (path: string) => async (by: Caller) => (await readById<unknown>(path)(by)).filter((body) => JSON.stringify(body).includes(mar)).map(() => ({ id: mar }));
    const seenBy = [k1Ap, tower.c1Engineer];
    await expectHiddenFrom({ read: marIdIn(`/v1/work-items/${wir}`), target: mar, seenBy, hiddenFrom: inspector, name: named, label: "the MAR's id on the WIR's page" });
    await expectHiddenFrom({ read: readById(`/v1/work-items/${mar}`), target: mar, seenBy: [k1Ap, tower.k1Manager], hiddenFrom: inspector, name: named, label: "the MAR" });
  });

  it("offers a filler in Link search only the A and B items they see, and refuses a save naming another like an unknown option", async () => {
    const accepts = new URLSearchParams({ q: "Cable", modules: "submittals", outcomes: "A,B" }).toString();
    const offered = async (by: Caller) => ((await ok(by.get(`/v1/projects/${tower.projectId}/work-items/link-search?${accepts}`), 200)).json() as LinkSearchResults).links;
    await expectHiddenFrom({ read: offered, target: mar, seenBy: tower.c1Engineer, hiddenFrom: c1Filler, name: named, label: "Link search" });
    const unseen = await c1Filler.post(`/v1/projects/${tower.projectId}/work-items`, { type: "WIR", title: "Trays, bay 2", answers: wirAnswers(tower, wirChecklist, { approved_submittals: [mar] }) });
    expect({ status: unseen.statusCode, body: unseen.json() }).toEqual({ status: 422, body: { error: "invalid_answers", fields: [{ key: "approved_submittals", code: "unknown_option" }] } });
    // A made-up id reads the same.
    const madeUp = await tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: "WIR", title: "Trays, bay 3", answers: wirAnswers(tower, wirChecklist, { approved_submittals: [randomUUID()] }) });
    expect({ status: madeUp.statusCode, body: madeUp.json() }).toEqual({ status: 422, body: { error: "invalid_answers", fields: [{ key: "approved_submittals", code: "unknown_option" }] } });
  });
});

describe("RP-82-2: which link questions a Project makes required", () => {
  const settings = async (by: Caller, project = tower.projectId): Promise<ProjectRequiredFields> => (await ok(by.get(`/v1/projects/${project}/required-fields`), 200)).json();
  const set = (by: Caller, required: boolean, project = tower.projectId) =>
    by.request("PUT", `/v1/projects/${project}/required-fields`, { type: "WIR", key: "approved_submittals", required });
  const approvedSubmittals = (s: ProjectRequiredFields) => s.fields.find((f) => f.type === "WIR" && f.key === "approved_submittals");
  /** [the Project] when `by` reads its Required links. */
  const settingsRead = (project: string) => async (by: Caller) => (await readById<ProjectRequiredFields>(`/v1/projects/${project}/required-fields`)(by)).map(() => ({ id: project }));
  const sendForReview = async (at: Tower, checklist: string) => {
    const id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: "WIR", title: "Trays", answers: wirAnswers(at, checklist) }), 201)).json().id as string;
    return tryTake(at.c1Engineer, id, "send_for_review");
  };
  let towerMembers: Caller[] = [];

  beforeAll(async () => {
    towerMembers = [tower.admin!, tower.c1Engineer, k1Ap, inspector];
    await ok(set(tower.admin!, true));
    await ok(set(other.admin!, true, other.projectId));
  });

  it("is read by every Tower Member of every Participant, and never by another Project's Admin, nor theirs by Tower's", async () => {
    await expectHiddenFrom({ read: settingsRead(tower.projectId), target: tower.projectId, seenBy: towerMembers, hiddenFrom: other.admin!, name: named, label: "Tower's" });
    await expectHiddenFrom({ read: settingsRead(other.projectId), target: other.projectId, seenBy: other.admin!, hiddenFrom: towerMembers, name: named, label: "the other Project's" });
    for (const by of towerMembers) expect(approvedSubmittals(await settings(by))?.required, named(by)).toBe(true);
  });

  it("names nobody who set it, nor when", async () => {
    for (const by of towerMembers) {
      const read = await settings(by);
      expect(Object.keys(read).sort()).toEqual(["canEdit", "fields"]);
      expect(Object.keys(approvedSubmittals(read)!).sort()).toEqual(["key", "label", "required", "requiredByForm", "type", "typeName"]);
    }
  });

  it("is changed by Tower's Project Admin only: anyone else, and a made-up Project, get the plain 404, and nothing changes", async () => {
    for (const by of [tower.c1Engineer, k1Ap, inspector, other.admin!]) await expectHidden(set(by, false), named(by)); // not hidden-from: a refused write; the reads above prove the setting with expectHiddenFrom
    await expectHidden(set(tower.admin!, false, randomUUID())); // not hidden-from: no such Project
    expect(approvedSubmittals(await settings(tower.c1Engineer))?.required).toBe(true);
  });

  it("on, a Tower WIR can't leave Draft without an Approved submittal, naming the field; each Project's WIRs follow their own setting", async () => {
    const otherChecklist = await checklistTemplate(other.admin!, other.projectId, other.electrical);
    const refused = await sendForReview(tower, wirChecklist);
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({ status: 422, body: { error: "form_incomplete", fields: [{ key: "approved_submittals", code: "required" }] } });
    await ok(set(tower.admin!, false));
    expect((await sendForReview(tower, wirChecklist)).statusCode).toBe(204);
    // Tower's off changes nothing on the other Project, which keeps it on.
    expect((await sendForReview(other, otherChecklist)).json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "approved_submittals", code: "required" }] });
    await ok(set(other.admin!, false, other.projectId));
    expect((await sendForReview(other, otherChecklist)).statusCode).toBe(204);
  });
});
