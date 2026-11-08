// Seam 1 for RP-1263 (RP-952 Q4 (a), owner 2026-11-08): a Cancelled item is read from its outcome,
// `cancelled`, everywhere. When Rabaed cancels an item at a Participant's withdrawal and its Workflow
// Version has no Step in a cancelled Stage, the item stays at its Step, but every reader who saw it
// before reads it in its Module's Cancelled Stage: the detail page with no Step, the List row and its
// Stage counts, the Kanban's Cancelled column, the shared download, and never as open work (the "open"
// filter, Need My Action). Nobody new reads it. Every Module has a Cancelled Stage: the Snag List's
// Rabaed Defaults gain one, and a Project Admin can't delete a Module's last one.
//
// Two Projects: a Submittal on a test Workflow with no Cancel (addSendBackType without withCancel),
// raised by C2 and held by K1 when C1 withdraws C2; and a Snag (the Rabaed Default Snag Workflow, which
// has no Cancel) raised by K1 and held by C1 when C1 withdraws K1.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type Home, type ProjectStages, type WorkItemBoard, type WorkItemDetail, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(async () => {
  await api.close();
});

const TYPE = "CNOC";
const schema = {
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
};

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

const withdraw = (by: Caller, participantId: string) => ok(by.post(`/v1/participants/${participantId}/withdraw`));
const itemById = (by: Caller, id: string) => readById<WorkItemDetail>(`/v1/work-items/${id}`)(by);
async function list(by: Caller, projectId: string, module: string, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
async function board(by: Caller, projectId: string, module: string): Promise<WorkItemBoard> {
  return (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items/kanban`), 200)).json();
}
const home = async (by: Caller): Promise<Home> => (await ok(by.get("/v1/home"), 200)).json();
const stagesOf = async (by: Caller, projectId: string, module: string): Promise<ProjectStages> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/stages`), 200)).json();
/** The ids of the cards in the Kanban column of Stage `stageKey`. */
const cardsIn = (b: WorkItemBoard, stageKey: string) => b.columns.find((c) => c.stageKey === stageKey)?.lanes.flatMap((l) => l.cards.map((c) => c.id)) ?? [];

beforeAll(async () => {
  const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
  await addSendBackType(migrator, TYPE, { en: "Cancelled from outcome", ar: "ملغى من النتيجة" }, schema);
  await migrator.destroy();
});

describe("a Submittal Rabaed cancels at its raiser's withdrawal, on a Workflow with no Cancelled Step", () => {
  let c1: Company;
  let c1Engineer: Caller;
  let k1Engineer: Caller;
  let k1Manager: Caller;
  let projectId = "";
  let c2Participant = "";
  let item = "";
  let oldStage = "";

  beforeAll(async () => {
    c1 = await api.projectCreator();
    projectId = (await api.createProject(c1.caller)).id;
    const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
    const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
    const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
    const buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
    const c1Participant = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    // C1 covers Building B only, so its engineer never reads the item (nobody new reads it).
    await ok(c1.caller.request("PUT", `/v1/participants/${c1Participant}/visibility`, { trade: all, location: only(buildingB) }));
    c1Engineer = await projectMember(api, c1, c1Participant, ["engineer"]);
    const join = async (role: "contractor" | "consultant") => {
      const company = await api.authorizedPerson();
      const id = await api.addParticipant(c1.caller, projectId, company.company, role);
      await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
      return { company, id };
    };
    const k = await join("consultant");
    k1Engineer = await projectMember(api, k.company, k.id, ["engineer"]);
    k1Manager = (await memberOnProject(api, k.company, k.id, ["manager"])).caller;
    const c = await join("contractor");
    c2Participant = c.id;
    const c2Engineer = await projectMember(api, c.company, c.id, ["engineer"]);
    const c2Pm = await projectMember(api, c.company, c.id, ["project_manager"]);
    for (const [by, name] of [
      [c1Engineer, "the C1 engineer (Building B only)"],
      [k1Engineer, "the K1 engineer"],
      [k1Manager, "the K1 manager"],
    ] as const)
      names.set(by, name);

    // C2 raises it; K1's engineer picks it up.
    item = (await ok(c2Engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "CNOC-1", answers: { model: "CNOC-1", trade: electrical, location: buildingA } }), 201)).json().id;
    await take(c2Engineer, item, "send_for_review");
    await ok(c2Pm.post(`/v1/work-items/${item}/pick-up`));
    await take(c2Pm, item, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${item}/pick-up`));
    oldStage = (await itemById(k1Engineer, item))[0]!.stage.key;
    expect((await home(k1Engineer)).needsMyAction.map((w) => w.id)).toContain(item);

    await withdraw(c1.caller, c2Participant);
  });

  it("the detail page: Cancelled, in the Cancelled Stage, with no Step, for every reader who saw it and nobody new", async () => {
    expect(oldStage).not.toBe("cancelled");
    await expectHiddenFrom({
      read: async (by) =>
        (await itemById(by, item)).filter((d) => d.outcome === "cancelled" && d.stage.key === "cancelled" && d.stage.category === "cancelled" && d.step === null),
      target: item,
      seenBy: [k1Engineer, k1Manager],
      hiddenFrom: [c1Engineer],
      name: nameOf,
      label: "the Cancelled item",
    });
  });

  it("the List: its row in the Cancelled Stage and counted there, and never as open work", async () => {
    const rows = await list(k1Engineer, projectId, "submittals");
    expect(rows.items.find((r) => r.id === item)?.stage).toMatchObject({ key: "cancelled", category: "cancelled" });
    expect(rows.stages.find((s) => s.key === "cancelled")?.count).toBe(1);
    expect(rows.stages.find((s) => s.key === oldStage)?.count ?? 0).toBe(0);
    // Open work: the Step Age filter (every open item with a Step Age) and Home's "waiting with others".
    expect((await list(k1Engineer, projectId, "submittals", { stepAgeMin: 1 })).items.map((r) => r.id)).not.toContain(item);
    expect((await list(k1Manager, projectId, "submittals", { heldBy: "others" })).items.map((r) => r.id)).not.toContain(item);
  });

  it("the Kanban: in the Cancelled column, not its last Step's", async () => {
    const b = await board(k1Engineer, projectId, "submittals");
    expect(cardsIn(b, "cancelled")).toContain(item);
    expect(cardsIn(b, oldStage)).not.toContain(item);
  });

  it("the shared download reads it in the Cancelled Stage", async () => {
    const shared = (await ok(k1Engineer.get(`/v1/work-items/${item}/shared`), 200)).json();
    expect(shared.stage).toMatchObject({ key: "cancelled", category: "cancelled" });
  });

  it("is no open work: gone from the holder's Need My Action", async () => {
    expect((await home(k1Engineer)).needsMyAction.map((w) => w.id)).not.toContain(item);
    expect((await list(k1Engineer, projectId, "submittals", { needMyAction: true })).items.map((r) => r.id)).not.toContain(item);
  });
});

describe("a Snag Rabaed cancels at its raiser's withdrawal: the Snag List has a Cancelled Stage", () => {
  let at: Tower;
  let c1: Company;
  let c2Engineer: Caller;
  let snag = "";

  beforeAll(async () => {
    c1 = await api.projectCreator();
    const k1 = await api.authorizedPerson();
    at = await buildTower(api, { c1, k1 }, "CNS");
    // C2 covers Building B only, so it never reads the Snag on Building A (nobody new reads it).
    const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
    const c2 = await api.authorizedPerson();
    const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
    c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
    for (const [by, name] of [
      [at.c1Pm, "the C1 PM"],
      [at.c1Engineer, "the C1 engineer"],
      [c2Engineer, "the C2 engineer (Building B only)"],
    ] as const)
      names.set(by, name);

    snag = (
      await ok(
        at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title: "Cable tray not bonded", answers: { description: "See the tray", trade: at.electrical, location: at.buildingA } }),
        201,
      )
    ).json().id;
    await take(at.k1Manager, snag, "raise");
    await ok(at.c1Pm.post(`/v1/work-items/${snag}/pick-up`));
    await withdraw(c1.caller, at.k1ParticipantId!);
  });

  it("a new Project's Snag List has a Cancelled Stage, after its Closed", async () => {
    // After, not last: another test may add a Rabaed Default Stage of its own to the Module.
    const stages = (await stagesOf(at.c1Pm, at.projectId, "snag_list")).stages;
    const keys = stages.map((s) => s.key);
    expect(stages.find((s) => s.key === "cancelled")).toMatchObject({ category: "cancelled", name: { en: "Cancelled", ar: "ملغى" } });
    expect(keys.indexOf("cancelled")).toBeGreaterThan(keys.indexOf("closed"));
  });

  it("C1, which saw it, reads it Cancelled in the Cancelled Stage and Kanban column; C2 never reads it", async () => {
    await expectHiddenFrom({
      read: async (by) => (await itemById(by, snag)).filter((d) => d.outcome === "cancelled" && d.stage.category === "cancelled" && d.step === null),
      target: snag,
      seenBy: [at.c1Pm, at.c1Engineer],
      hiddenFrom: [c2Engineer],
      name: nameOf,
      label: "the Cancelled Snag",
    });
    await expectHiddenFrom({
      read: async (by) => (await board(by, at.projectId, "snag_list")).columns.filter((c) => c.stageKey === "cancelled").flatMap((c) => c.lanes.flatMap((l) => l.cards)),
      target: snag,
      seenBy: [at.c1Pm, at.c1Engineer],
      hiddenFrom: [c2Engineer],
      name: nameOf,
      label: "the Cancelled column",
    });
    expect((await list(at.c1Pm, at.projectId, "snag_list", { stepAgeMin: 1 })).items.map((r) => r.id)).not.toContain(snag);
  });

  it("the Project Admin can't delete the Module's last Cancelled Stage, but may delete one of two", async () => {
    const del = (key: string) => c1.caller.request("DELETE", `/v1/projects/${at.projectId}/modules/snag_list/stages/${key}`);
    const refused = await del("cancelled");
    expect({ status: refused.statusCode, error: refused.json().error }).toEqual({ status: 409, error: "last_cancelled_stage" });
    await ok(c1.caller.post(`/v1/projects/${at.projectId}/modules/snag_list/stages`, { key: "withdrawn", name: bilingual("Withdrawn"), category: "cancelled" }), 201);
    await ok(del("withdrawn"));
    expect((await stagesOf(c1.caller, at.projectId, "snag_list")).stages.filter((s) => s.category === "cancelled").map((s) => s.key)).toEqual(["cancelled"]);
  });
});
