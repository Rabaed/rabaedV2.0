// Seam 1 for Code B's Comments (RP-434, WF-11; spec RP-423; glossary Comment,
// Outcome; workflow-engine.md §1 "Outcomes", §6; visibility.md scenarios RP-434-1 to
// RP-434-3).
//
// An outcome whose follow-up actions create items (Code B: Comments, Type CMT) makes
// one Comment per row of its Action Form's `items_to_create` table, in the Snag List:
// raised by the reviewer, `raised_from`-linked to the reviewed item, Open with the
// item's raiser, visible to the Participants who see the item. The Contractor resolves
// a Comment with a note in its reply; the Consultant closes it or Returns it to Open. The reviewed
// item counts its Comments open and closed, only those the viewer sees.
//
// The reviewed Type is test-only, on the test Workflow with Code B (addSendBackType,
// `withApproveB`); the Comments run the Rabaed Default Comment Workflow.
import { rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, rabaedDefaultWorkflowId, readLatestPublishedDefinition } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { parseWorkflowDefinition, type WorkItemBoard, type WorkItemDetail, type WorkItemLinks, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, ok, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "CBR";
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

let c1: Company;
let k1: Company;
let c2: Company;
let at: Tower;
let c2Engineer: Caller; // Another Contractor on the Project, of the same Trade (V3).
let orEngineer: Caller; // The Owner Representative: oversight of Submitted items (V2).

const comments = async (by: Caller): Promise<WorkItemList["items"]> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json().items;
/** The Comments `by` sees in the Snag List whose `raised_from` Link names `source`. */
const raisedFrom = async (by: Caller, source: string): Promise<WorkItemList["items"]> => {
  const links = await Promise.all(
    (await comments(by)).map(async (c) => ({ c, links: (await ok(by.get(`/v1/work-items/${c.id}/links`), 200)).json() as WorkItemLinks })),
  );
  return links.filter((l) => l.links.links.some((x) => x.kind === "raised_from" && x.workItemId === source)).map((l) => l.c);
};
const counts = async (by: Caller, id: string): Promise<WorkItemDetail["comments"]> => (await detail(by, id)).comments;

/** A MAR-like item of C1's, Submitted to K1 and with K1's manager at the Code, which they then take as B with `rows`. */
async function closedAtB(title: string, rows: { comment: string; reference?: string }[]): Promise<string> {
  const id = (
    await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: TYPE,
        title,
        answers: { model: title, trade: at.electrical, location: at.buildingA },
      }),
      201,
    )
  ).json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, "send_to_manager");
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, "approve_b", { answers: { remarks: "Approved with comments", items_to_create: rows } });
  return id;
}

/** C1's PM picks up the Comment and resolves it, with the resolution note in its reply (the Resolve Screen, RP-437). */
async function resolve(id: string, note: string) {
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "resolve", { answers: { resolution_note: note } });
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Code B review", ar: "مراجعة الرمز B" }, schema, { withApproveB: true });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
  const or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "CBC");
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  orEngineer = await projectMember(api, or, orParticipant, ["engineer"]);
});

describe("Code B with three rows makes three Comments in the Snag List (seam 1)", () => {
  it("raises one Comment per row, Open with C1, raised_from-linked, numbered, the row's cells its answers", async () => {
    const source = await closedAtB("Cable trays", [
      { comment: "Add the fire rating to the datasheet", reference: "Datasheet p.2" },
      { comment: "Confirm the finish" },
      { comment: "Show the support spacing" },
    ]);
    expect((await detail(at.k1Manager, source)).outcome).toBe("B");

    const raised = await raisedFrom(at.c1Pm, source);
    expect(raised.map((c) => c.title).sort()).toEqual(["Add the fire rating to the datasheet", "Confirm the finish", "Show the support spacing"]);
    for (const c of raised) {
      expect(c.type.code).toBe("CMT");
      expect(c.stage.key).toBe("open");
      expect(c.documentNumber).not.toBeNull();
    }
    const first = await detail(at.c1Pm, raised.find((c) => c.title.startsWith("Add the fire"))!.id);
    expect(first.answers).toMatchObject({ comment: "Add the fire rating to the datasheet", reference: "Datasheet p.2", trade: at.electrical, location: at.buildingA });
    expect(first.workflow.name.en).toBe("Comment");
    expect(first.step.key).toBe("open");
    expect(first.heldBy?.memberName).toBeNull(); // C1's Step Pool, notPickedUp.
    expect(await counts(at.c1Pm, source)).toEqual({ open: 3, closed: 0 });
    expect(await counts(at.k1Manager, source)).toEqual({ open: 3, closed: 0 });
  });

  it("the Contractor resolves one, the Consultant closes it, Returns another to Open; the counts follow", async () => {
    const source = await closedAtB("Lighting", [{ comment: "Fix the lux levels" }, { comment: "Add emergency fittings" }, { comment: "Label circuits" }]);
    const byTitle = new Map((await raisedFrom(at.c1Pm, source)).map((c) => [c.title, c.id]));
    const lux = byTitle.get("Fix the lux levels")!;
    const emergency = byTitle.get("Add emergency fittings")!;

    // Resolving asks for the resolution note: C1's reply, in the Resolve Screen (ADR 0019).
    await ok(at.c1Pm.post(`/v1/work-items/${lux}/pick-up`));
    const noNote = await tryTake(at.c1Pm, lux, "resolve");
    expect(noNote.statusCode, noNote.body).toBe(422);
    await ok(at.c1Pm.post(`/v1/work-items/${lux}/return-to-pool`));

    await resolve(lux, "Lux levels recalculated");
    const resolved = await detail(at.k1Manager, lux);
    expect(resolved.step.key).toBe("resolved");
    // The note is shared with the Resolve: K1 reads it in the history, never in the Form.
    expect(resolved.answers).not.toHaveProperty("resolution_note");
    const resolveEvent = ((await ok(at.k1Manager.get(`/v1/work-items/${lux}/history`), 200)).json().events as { answers: Record<string, unknown> | null }[]).filter((e) => e.answers).at(-1);
    expect(resolveEvent!.answers).toEqual({ resolution_note: "Lux levels recalculated" });
    await ok(at.k1Manager.post(`/v1/work-items/${lux}/pick-up`));
    await take(at.k1Manager, lux, "close");
    expect((await detail(at.c1Pm, lux)).outcome).toBe("closed");
    expect(await counts(at.c1Pm, source)).toEqual({ open: 2, closed: 1 });

    await resolve(emergency, "Added");
    await ok(at.k1Manager.post(`/v1/work-items/${emergency}/pick-up`));
    await take(at.k1Manager, emergency, "return_to_open", { reason: "Not on the drawing yet" });
    const back = await detail(at.c1Pm, emergency);
    expect(back.step.key).toBe("open");
    // Back with C1, the Contractor that resolved it, which may resolve it again.
    expect(back.heldBy?.companyName).toEqual((await detail(at.c1Pm, source)).raisedBy.companyName);
    expect(back.actions.transitions.map((t) => t.key)).toContain("resolve");
    expect(await counts(at.k1Manager, source)).toEqual({ open: 2, closed: 1 });
  });

  it("takes Code B with no rows as before: no Comment, and the counts are zero", async () => {
    const source = await closedAtB("Conduits", []);
    expect(await raisedFrom(at.c1Pm, source)).toEqual([]);
    expect(await counts(at.c1Pm, source)).toEqual({ open: 0, closed: 0 });
  });

  it("lists the Comments in the Snag List's List and Kanban, by its Stages", async () => {
    const source = await closedAtB("Switchgear", [{ comment: "Show the IP rating" }]);
    expect((await raisedFrom(at.c1Pm, source)).length).toBe(1);
    const board = (await ok(at.c1Pm.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items/kanban`), 200)).json() as WorkItemBoard;
    // The Snag List's Stages (another suite may add test-only ones to the Rabaed set).
    expect(board.columns.map((c) => c.stageKey)).toEqual(expect.arrayContaining(["draft", "open", "resolved", "closed"]));
    expect(board.columns.find((c) => c.stageKey === "open")!.shown).toBeGreaterThan(0);
  });
});

describe("Comments are seen where their reviewed item is (scenarios RP-434-1 to RP-434-3)", () => {
  it("RP-434-1: C2, another Contractor of the same Trade, never sees C1's Comments, nor their count", async () => {
    const source = await closedAtB("Busbars", [{ comment: "Check the rating" }]);
    const [comment] = await raisedFrom(at.c1Pm, source);
    expect(await comments(c2Engineer)).toEqual([]);
    expectHidden(await c2Engineer.get(`/v1/work-items/${comment!.id}`));
    expectHidden(await c2Engineer.get(`/v1/work-items/${source}`));
  });

  it("RP-434-2: the reviewing Consultant sees the Comments it raised; the Owner Representative sees them as it sees the item", async () => {
    const source = await closedAtB("Earthing", [{ comment: "Add the test report" }]);
    const [comment] = await raisedFrom(at.c1Pm, source);
    expect((await comments(at.k1Manager)).map((c) => c.id)).toContain(comment!.id);
    expect((await comments(orEngineer)).map((c) => c.id)).toContain(comment!.id);
    expect(await counts(orEngineer, source)).toEqual({ open: 1, closed: 0 });
  });

  it("RP-434-3: counts only the Comments the viewer sees: a Member whose Visibility doesn't cover them counts none", async () => {
    const source = await closedAtB("Panels", [{ comment: "Add the schedule" }]);
    const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
    const c1Mechanical = await projectMember(api, c1, participants.find((p) => p.isOwnCompany)!.id, ["engineer"], { trade: { isAll: false, valueIds: [at.mechanical] } });
    expectHidden(await c1Mechanical.get(`/v1/work-items/${source}`));
    expect(await comments(c1Mechanical)).toEqual([]);
    expect(await counts(at.c1Pm, source)).toEqual({ open: 1, closed: 0 });
  });
});

describe("the Rabaed Default Comment Workflow", () => {
  it("is the document `pnpm defaults:publish` publishes (apps/admin/workflows/CMT.json), as its latest Version: Version 1, migrated, then 2 with the Resolve Screen (RP-437)", async () => {
    const definitionId = (await rabaedDefaultWorkflowId(migrator, "CMT"))!;
    const latest = (await readLatestPublishedDefinition(migrator, definitionId))!;
    expect(latest.versionNo).toBe(2);
    const file = parseWorkflowDefinition(rabaedWorkflowFile("CMT.json"));
    expect(file.ok && sameDefinition(latest.definition, file.definition)).toBe(true);
    expect(latest.definition.transitions.find((t) => t.key === "resolve")).toMatchObject({ screen: "comment_resolution", actionForm: null });
  });
});
