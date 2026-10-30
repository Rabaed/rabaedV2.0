// Seam 1 for the Company Library of Workflows (RP-442, WF-19; spec RP-423; ADR 0016;
// workflow-engine.md §1 "The Library"; visibility.md V18, V20, scenario RP-442-1). A Company's
// Authorized Person saves a Workflow to the Library (a copy), edits it there (each edit a new
// Version of the Library copy) and its Project Admins copy it into a Project. The Library is
// private to the Company until a copy is made into a Project.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { LibraryWorkflows, SavedToLibrary, WorkflowBuilderRead, WorkflowMapRead, WorkflowRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { buildTower, ok, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const label = (en: string) => ({ en, ar: `${en} (ar)` });
const TOWER_ROUTE = label("Tower MAR route");
const SAVED = label("TMC saved route");

let tmc: Company; // Creates Tower: Authorized Person and Project Admin.
let k1: Company; // Tower's Consultant, with a Library of its own.
let outsider: Company; // On no shared Project.
let at: Tower;
let towerRoute = "";
let librarySaved = "";

const library = async (by: Company["caller"]): Promise<LibraryWorkflows> => (await ok(by.get("/v1/library/workflows"), 200)).json();
const ids = (list: LibraryWorkflows) => list.workflows.map((w) => w.id);

// The reads a hidden-from assert makes (RP-1126): the Library's list, and a Workflow read by
// id, as its read, its map and its builder.
const inLibrary = async (by: Caller) => (await library(by)).workflows;
const workflowRead = (id: string) => readById<WorkflowRead>(`/v1/workflows/${id}`);
const mapRead = (id: string) => async (by: Caller) => (await readById<WorkflowMapRead>(`/v1/workflows/${id}/map`)(by)).map((m) => m.workflow);
const builderRead = (id: string) => async (by: Caller) => (await readById<WorkflowBuilderRead>(`/v1/workflows/${id}/builder`)(by)).map((b) => b.workflow);
const callers = new Map<Caller, string>();
const who = (by: Caller) => callers.get(by) ?? "a caller";

beforeAll(async () => {
  tmc = await api.projectCreator();
  k1 = await api.authorizedPerson();
  outsider = await api.authorizedPerson();
  at = await buildTower(api, { c1: tmc, k1 }, "WL1");
  callers.set(tmc.caller, "TMC's Authorized Person").set(k1.caller, "K1's Authorized Person").set(outsider.caller, "the outsider's Authorized Person").set(at.c1Pm, "TMC's PM");
});

describe("saving a Workflow to the Library", () => {
  it("is a copy, published at once, which the Company's Members list", async () => {
    // Tower's own Workflow: a Project Admin copies a Rabaed Default in, then publishes it.
    const source = await rabaedMar();
    const copy = await ok(tmc.caller.post(`/v1/workflows/${source}/duplicate`, { projectId: at.projectId, name: TOWER_ROUTE }), 201);
    towerRoute = copy.json().id;
    await ok(tmc.caller.post(`/v1/workflows/${towerRoute}/publish`), 200);

    const saved: SavedToLibrary = (await ok(tmc.caller.post(`/v1/workflows/${towerRoute}/save-to-library`, { name: SAVED }), 201)).json();
    expect(saved).toMatchObject({ published: true });
    librarySaved = saved.id;
    expect(saved.id).not.toBe(towerRoute);

    const list = await library(tmc.caller);
    expect(list.workflows).toEqual([
      expect.objectContaining({
        id: librarySaved,
        name: SAVED,
        publishedVersions: [1],
        isDefault: false,
        workItemType: expect.objectContaining({ code: "MAR" }),
      }),
    ]);
    // Any Member of the Company lists it.
    const member = await api.member(tmc.caller);
    expect(ids(await library(member.caller))).toEqual([librarySaved]);
  });

  it("is for the Authorized Person alone: a plain Member, and a made-up Workflow, get the plain 404", async () => {
    const member = await api.member(tmc.caller);
    await expectHidden(member.caller.post(`/v1/workflows/${towerRoute}/save-to-library`, { name: label("Nope") })); // not hidden-from: a refused write (only the Authorized Person saves to the Library); the list below shows nothing was saved
    await expectHidden(tmc.caller.post(`/v1/workflows/00000000-0000-4000-8000-000000000000/save-to-library`, { name: label("Nope") })); // not hidden-from: a made-up id, the answer a refusal must look like
    expect(ids(await library(tmc.caller))).toEqual([librarySaved]);
  });

  it("is a copy that keeps no link: changing either leaves the other as it was", async () => {
    const read = (await ok(tmc.caller.get(`/v1/workflows/${librarySaved}`), 200)).json();
    const edited = {
      ...read.published.definition,
      steps: read.published.definition.steps.map((s: { key: string; name: { en: string; ar: string } }, i: number) =>
        i === 0 ? { ...s, name: label("Renamed in the Library") } : s,
      ),
    };
    await ok(tmc.caller.request("PUT", `/v1/workflows/${librarySaved}/draft`, { definition: edited }), 200);
    const published = (await ok(tmc.caller.post(`/v1/workflows/${librarySaved}/publish`), 200)).json();
    // Each edit of the Library copy is a new Version of it.
    expect(published.versionNo).toBe(2);
    expect((await library(tmc.caller)).workflows[0]!.publishedVersions).toEqual([1, 2]);
    const tower = (await ok(tmc.caller.get(`/v1/workflows/${towerRoute}`), 200)).json();
    expect(tower.publishedVersions).toEqual([1]);
    expect(JSON.stringify(tower.published.definition)).not.toContain("Renamed in the Library"); // not hidden-from: Tower's copy kept its own Step name
  });
});

describe("using a Library Workflow on a Project", () => {
  it("copies it into a Project the Member is Project Admin of, as an independent draft", async () => {
    const copy = await ok(tmc.caller.post(`/v1/workflows/${librarySaved}/duplicate`, { projectId: at.projectId, name: label("Tower, from the Library") }), 201);
    const id = copy.json().id as string;
    const builder = (await ok(tmc.caller.get(`/v1/workflows/${id}/builder`), 200)).json();
    expect(builder.workflow).toMatchObject({ owner: "project", projectId: at.projectId, publishedVersions: [] });
    expect(builder.workflow.draft.versionNo).toBe(1);
    // Never published, so Tower's other Members don't read it yet (V20).
    await expectHiddenFrom({ read: workflowRead(id), target: id, seenBy: tmc.caller, hiddenFrom: at.c1Pm, name: who, label: "an unpublished copy in Tower" });
  });

  it("is refused to a Member who is not that Project's Admin, whatever the Library says", async () => {
    // TMC's PM, a Member of TMC, reads the Library copy; K1 doesn't (V18).
    await expectHiddenFrom({ read: workflowRead(librarySaved), target: librarySaved, seenBy: [tmc.caller, at.c1Pm], hiddenFrom: k1.caller, name: who, label: "TMC's Library copy" });
    const before = (await ok(tmc.caller.get(`/v1/projects/${at.projectId}/workflow-settings`), 200)).body;
    await expectHidden(at.c1Pm.post(`/v1/workflows/${librarySaved}/duplicate`, { projectId: at.projectId, name: label("Nope") })); // not hidden-from: a refused write (not the Project's Admin); the read above proves who reads the row
    await expectHidden(k1.caller.post(`/v1/workflows/${librarySaved}/duplicate`, { projectId: at.projectId, name: label("Nope") })); // not hidden-from: a refused write; the read above proves the row with expectHiddenFrom
    expect((await ok(tmc.caller.get(`/v1/projects/${at.projectId}/workflow-settings`), 200)).body).toBe(before);
  });
});

describe("the Library is private to its Company (scenario RP-442-1, V18)", () => {
  it("lists only the Company's own: another Company, Tower's Consultant included, sees nothing of it", async () => {
    expect(ids(await library(k1.caller))).toEqual([]); // not hidden-from: K1 has saved nothing to its own Library yet, so it lists nothing; the reads below prove TMC's row by id
    expect(ids(await library(outsider.caller))).toEqual([]); // not hidden-from: the outsider has saved nothing to its own Library yet, so it lists nothing; the reads below prove TMC's row by id
    const member = await api.member(tmc.caller);
    callers.set(member.caller, "a plain Member of TMC");
    const others = [k1.caller, outsider.caller];
    const hidden = (read: (by: Caller) => Promise<readonly { id: string }[]>, seenBy: Caller[], what: string) =>
      expectHiddenFrom({ read, target: librarySaved, seenBy, hiddenFrom: others, name: who, label: what });
    await hidden(inLibrary, [tmc.caller, member.caller], "the Library list");
    await hidden(workflowRead(librarySaved), [tmc.caller, member.caller], "the Workflow");
    await hidden(mapRead(librarySaved), [tmc.caller, member.caller], "its map");
    await hidden(builderRead(librarySaved), [tmc.caller], "its builder");
    for (const other of others) {
      await expectHidden(other.post(`/v1/workflows/${librarySaved}/save-to-library`, { name: label("Taken") })); // not hidden-from: a refused write; the reads above prove the row with expectHiddenFrom
    }
    expect(ids(await library(k1.caller))).toEqual([]); // not hidden-from: the refused save put no copy in K1's Library
  });

  it("shows another Company the copy only once it is in a Project it is on, and it can save that to its own Library", async () => {
    // Tower's own Workflow is read by every Participant (V20), so Beta Build can keep a copy.
    // Its Authorized Person works on Tower too.
    const participants = (await ok(tmc.caller.get(`/v1/projects/${at.projectId}/participants`), 200)).json().participants as { id: string; isOwnCompany: boolean }[];
    const k1Participant = participants.find((p) => !p.isOwnCompany)!;
    const k1Me = (await ok(k1.caller.get("/v1/me"), 200)).json();
    await api.addProjectMember(k1.caller, k1Participant.id, k1Me.member.id);
    const map: WorkflowMapRead = (await ok(k1.caller.get(`/v1/workflows/${towerRoute}/map`), 200)).json();
    expect(map.workflow.name).toEqual(TOWER_ROUTE);
    expect(map.workflow.canAuthor).toBe(false);
    expect(map.workflow.draft).toBeNull();
    const saved: SavedToLibrary = (await ok(k1.caller.post(`/v1/workflows/${towerRoute}/save-to-library`, { name: label("Beta Build route") }), 201)).json();
    expect(saved.published).toBe(true);
    expect(ids(await library(k1.caller))).toEqual([saved.id]);
    // And TMC's Library is still TMC's alone.
    expect(ids(await library(tmc.caller))).toEqual([librarySaved]);
    await expectHiddenFrom({ read: inLibrary, target: saved.id, seenBy: k1.caller, hiddenFrom: tmc.caller, name: who, label: "K1's Library list" });
    await expectHiddenFrom({ read: workflowRead(saved.id), target: saved.id, seenBy: k1.caller, hiddenFrom: tmc.caller, name: who, label: "K1's Library copy" });
  });

  it("keeps a copy nobody has published to its Authorized Person", async () => {
    const draftOnly = (await ok(tmc.caller.post(`/v1/workflows/${librarySaved}/duplicate`, { projectId: null, name: label("TMC unfinished") }), 201)).json().id as string;
    const member = await api.member(tmc.caller);
    callers.set(member.caller, "a plain Member of TMC");
    await expectHiddenFrom({ read: inLibrary, target: draftOnly, seenBy: tmc.caller, hiddenFrom: member.caller, name: who, label: "the Library list" });
    await expectHiddenFrom({ read: mapRead(draftOnly), target: draftOnly, seenBy: tmc.caller, hiddenFrom: member.caller, name: who, label: "its map" });
  });
});

describe("looking at a Library Workflow", () => {
  it("gives a plain Member the map to read, and nothing to edit", async () => {
    const member = await api.member(tmc.caller);
    const map: WorkflowMapRead = (await ok(member.caller.get(`/v1/workflows/${librarySaved}/map`), 200)).json();
    expect(map.workflow).toMatchObject({ owner: "company", canAuthor: false, draft: null, publishedVersions: [1, 2] });
    expect(map.stages.length).toBeGreaterThan(0);
    expect(map.positions.length).toBeGreaterThan(0);
    callers.set(member.caller, "a plain Member of TMC");
    await expectHiddenFrom({ read: builderRead(librarySaved), target: librarySaved, seenBy: tmc.caller, hiddenFrom: member.caller, name: who, label: "the builder" });
    expect((await member.caller.request("PUT", `/v1/workflows/${librarySaved}/draft`, { definition: map.workflow.published?.definition })).statusCode).toBe(404);
  });

  it("opens the builder for the Authorized Person", async () => {
    const builder = (await ok(tmc.caller.get(`/v1/workflows/${librarySaved}/builder`), 200)).json();
    expect(builder.workflow.canAuthor).toBe(true);
    expect(builder.type.code).toBe("MAR");
  });
});

/** The MAR's Rabaed Default Workflow. */
async function rabaedMar(): Promise<string> {
  const rows = await sql<{ id: string }>`
    select workflow_definition_id as id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  return rows.rows[0]!.id;
}
