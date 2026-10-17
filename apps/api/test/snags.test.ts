// Seam 1 for the Snag (RP-90, SNAG-1; spec RP-619; glossary Snag, Snag List, Stage,
// Step, Step Age; workflow-engine.md §3.1, §6, §10, §12; visibility.md V3, V5, V14 and
// scenarios RP-90-1 to RP-90-3).
//
// A Consultant raises a Snag (Type SNG, the Rabaed Default Snag Workflow) with photos on
// the one Contractor covering its Trade and Location. The Contractor moves it between
// Open, In Progress and On Hold inside its own Company, then resolves it with a note in
// the Resolve Screen; the Consultant verifies it: Close, or Return to Open with a reason,
// which reaches the Contractor that resolved it. Inside the Contractor Step Age restarts
// at each move; the Consultant counts it from when the Snag reached the Contractor.
import { rabaedFormFile, rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, rabaedDefaultWorkflowId, readLatestPublishedDefinition } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, parseWorkflowDefinition, sameJson, type DocumentList, type WorkItemBoard, type WorkItemHistory, type WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let k1: Company;
let at: Tower;
let buildingB = "";
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const board = async (by: Caller): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items/kanban`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;

/** K1's manager's Draft Snag on Building A, Electrical, with `photos` photos. */
async function draftSnag(title: string, { photos = 0, location = at.buildingA } = {}): Promise<string> {
  const id = (
    await ok(
      at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "SNG",
        title,
        answers: { description: `${title}: see the photos`, trade: at.electrical, location },
      }),
      201,
    )
  ).json().id as string;
  for (let i = 0; i < photos; i++) {
    await uploadDocument(at.k1Manager, id, { fieldKey: "photos", fileName: `before-${i}.jpg`, contentType: "image/jpeg", body: jpegWithExif() });
  }
  return id;
}

/**
 * C1's PM moves Snag `id` by `transition` and holds it at its new Step: a `send` leaves it in
 * C1's Step Pool (both C1 Members may work it), a `return` goes back to who held that Step (§3.3).
 */
async function move(id: string, transition: string) {
  await take(at.c1Pm, id, transition);
  if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
}

/** A Snag K1's manager raised, Open with C1. */
async function raised(title: string, photos = 0): Promise<string> {
  const id = await draftSnag(title, { photos });
  await take(at.k1Manager, id, "raise");
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SNT");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("a Consultant's Snag on the one Contractor covering it (seam 1)", () => {
  it("is raised with two photos, numbered SNG, and goes straight to C1, Open", async () => {
    const id = await draftSnag("Cable tray not bonded", { photos: 2 });
    await take(at.k1Manager, id, "raise");

    const seen = await detail(at.c1Pm, id);
    expect(seen.type.code).toBe("SNG");
    expect(seen.documentNumber).toMatch(/-SNG-/);
    expect(seen.step.key).toBe("open");
    expect(seen.stage.key).toBe("open");
    expect(seen.actions.pickUp).toBe(true); // In C1's Step Pool.
    expect(seen.answers).toMatchObject({ description: "Cable tray not bonded: see the photos", trade: at.electrical, location: at.buildingA });
    const documents: DocumentList = (await ok(at.c1Pm.get(`/v1/work-items/${id}/documents`), 200)).json();
    expect(documents.documents.filter((d) => d.fieldKey === "photos")).toHaveLength(2);
  });

  it("C1 moves it In Progress → On Hold → Open, resolves it with a note, K1 returns it to C1, C1 resolves it again and K1 closes it", async () => {
    const id = await raised("Rubbish on floor 3");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await move(id, "start_work");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("in_progress");
    await move(id, "hold");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("on_hold");
    await move(id, "reopen");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("open");

    // Resolving asks for the resolution note, C1's reply in the Resolve Screen (ADR 0019).
    const noNote = await tryTake(at.c1Pm, id, "resolve");
    expect(noNote.statusCode, noNote.body).toBe(422);
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Bonded and tested" } });
    const atVerify = await detail(at.k1Manager, id);
    expect(atVerify.step.key).toBe("verify");
    expect(atVerify.stage.key).toBe("resolved");
    expect((await history(at.k1Manager, id)).filter((e) => e.answers).at(-1)!.answers).toEqual({ resolution_note: "Bonded and tested" });

    // K1's manager is the only one who can verify it, so holds it at once (§3.3 rule 4).
    const noReason = await tryTake(at.k1Manager, id, "return_to_open");
    expect(noReason.statusCode, noReason.body).toBe(422);
    await take(at.k1Manager, id, "return_to_open", { reason: "The bonding jumper is missing at the riser" });
    const back = await detail(at.c1Pm, id);
    expect(back.step.key).toBe("open");
    // Back with C1, held again by the PM who held Open before (§3.3 rule 1).
    expect(back.actions.transitions.map((t) => t.key)).toEqual(expect.arrayContaining(["start_work", "put_on_hold", "resolve"]));

    await move(id, "start_work");
    await take(at.c1Pm, id, "resolve_in_progress", { answers: { resolution_note: "Jumper added" } });
    await take(at.k1Manager, id, "close");
    const closed = await detail(at.c1Pm, id);
    expect(closed.outcome).toBe("closed");
    expect(closed.stage.key).toBe("closed");
  });

  it("shows in the Snag List's List and Kanban, by its Stages", async () => {
    const id = await raised("Corner to clean");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await move(id, "put_on_hold");
    const list = await snags(at.c1Pm);
    expect(list.items.find((i) => i.id === id)?.stage.key).toBe("on_hold");
    const columns = (await board(at.c1Pm)).columns.map((c) => c.stageKey);
    // The Snag List's Stages in order (another suite may add test-only ones to the Rabaed set).
    const ours = columns.filter((k) => ["draft", "open", "in_progress", "on_hold", "resolved", "closed"].includes(k));
    expect(ours).toEqual(["draft", "open", "in_progress", "on_hold", "resolved", "closed"]);
    expect(JSON.stringify((await board(at.c1Pm)).columns.find((c) => c.stageKey === "on_hold"))).toContain(id);
  });
});

describe("Step Age of a Snag inside C1 and as K1 sees it (V14)", () => {
  it("restarts inside C1 at each move; K1 counts it from when the Snag reached C1 and sees it Open", async () => {
    const id = await raised("Slab level");
    const reached = (await detail(at.k1Manager, id)).stepEnteredAt;
    expect(reached).not.toBeNull();
    expect((await detail(at.c1Pm, id)).stepEnteredAt).toBe(reached);

    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    let previous = reached!;
    for (const step of ["start_work", "hold", "resume"]) {
      await move(id, step);
      const inside = (await detail(at.c1Pm, id)).stepEnteredAt!;
      expect(Date.parse(inside)).toBeGreaterThan(Date.parse(previous));
      previous = inside;
      const outside = await detail(at.k1Manager, id);
      expect(outside.stepEnteredAt).toBe(reached);
      expect(outside.stage.key).toBe("open");
    }
  });
});

describe("a Snag where two Contractors cover its Trade and Location", () => {
  it("is not raised: the Raise is refused with the Visibility Overlap's answer, and nothing reaches either Contractor", async () => {
    // A third Contractor of the same Trade, covering Building A too (a Visibility Overlap).
    const c3 = await api.authorizedPerson();
    const c3Participant = await api.addParticipant(c1.caller, at.projectId, c3.company, "contractor");
    const c3Engineer = await projectMember(api, c3, c3Participant, ["engineer"]);
    await ok(c1.caller.request("PUT", `/v1/participants/${c3Participant}/visibility`, { trade: all, location: all }));
    try {
      const id = await draftSnag("Two Contractors");
      expect((await detail(at.k1Manager, id)).actions.transitions.map((t) => t.key)).not.toContain("raise");
      const refused = await tryTake(at.k1Manager, id, "raise");
      expect({ status: refused.statusCode, body: refused.json() }).toEqual({ status: 409, body: { error: "next_step_unavailable" } });
      await expectHidden(at.c1Pm.get(`/v1/work-items/${id}`));
      await expectHidden(c3Engineer.get(`/v1/work-items/${id}`));
    } finally {
      await ok(c1.caller.request("PUT", `/v1/participants/${c3Participant}/visibility`, { trade: all, location: only(buildingB) }));
    }
  });
});

describe("C2 never sees C1's Snag; C1 never sees K1's internal events (scenarios RP-90-1, RP-90-2)", () => {
  it("RP-90-1: C2, another Contractor of the same Trade, sees it in no list, count or Kanban, by id, Links or history", async () => {
    const id = await raised("Not C2's", 1);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await move(id, "start_work");

    const list = await snags(c2Engineer);
    expect(list.items).toEqual([]);
    expect(list.stages.reduce((n, s) => n + s.count, 0)).toBe(0);
    const kanban = await board(c2Engineer);
    expect(kanban.columns.reduce((n, c) => n + c.shown, 0)).toBe(0);
    expect(JSON.stringify(kanban)).not.toContain(id);
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/history`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/links`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents`));
  });

  it("RP-90-2: C1 reads the shared history only (K1's Draft work stays K1's); K1 never reads C1's internal moves", async () => {
    const id = await raised("Shared history");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await move(id, "start_work");
    await take(at.c1Pm, id, "resolve_in_progress", { answers: { resolution_note: "Fixed" } });

    const c1Sees = await history(at.c1Engineer, id);
    expect(c1Sees[0]).toMatchObject({ type: "transition", audience: "shared", transition: { en: "Raise" } });
    const k1Sees = await history(at.k1Manager, id);
    expect(k1Sees.some((e) => e.transition?.en === "Start work")).toBe(false);
    expect(k1Sees.some((e) => e.type === "picked_up")).toBe(false);
    expect(k1Sees.filter((e) => e.type === "transition").map((e) => e.transition?.en)).toEqual(["Raise", "Resolve"]);
  });
});

describe("the Rabaed Default Snag Workflow and Form", () => {
  it("are the documents `pnpm defaults:publish` publishes (apps/admin/workflows/SNG.json, apps/admin/forms/SNG.json), as their latest Versions", async () => {
    const definitionId = (await rabaedDefaultWorkflowId(migrator, "SNG"))!;
    const latest = (await readLatestPublishedDefinition(migrator, definitionId))!;
    expect(latest.versionNo).toBe(1);
    const file = parseWorkflowDefinition(rabaedWorkflowFile("SNG.json"));
    expect(file.ok && sameDefinition(latest.definition, file.definition)).toBe(true);

    const { rows } = await sql<{ schema: unknown }>`
      select v.schema from form_version v
      join work_item_type t on t.form_definition_id = v.form_definition_id
      where t.owner_kind = 'rabaed' and t.code = 'SNG' and v.status = 'published'
      order by v.version_no desc limit 1
    `.execute(migrator);
    expect(sameJson(formSchema.parse(rows[0]!.schema), formSchema.parse(rabaedFormFile("SNG.json")))).toBe(true);
  });
});
