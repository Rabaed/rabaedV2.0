// Seam 1 for scenario RP-1219-1 (visibility.md row 73, V3): the Kanban's Draft column. C1 and C2, two
// Contractors on one Project, raise Submittal Drafts; K1 is its Consultant. The Kanban tells the web whether
// the viewer may raise a Type of the Module (`mayRaise`, the "+ New" Type picker's rule, which the Register Import's 403 also asks of the Submittals). Only then
// does it carry the Draft Stage and its column, holding the viewer's own Participant's Drafts, by Subject, then
// id, never by when they were started. K1, who may raise no Submittal, gets no Draft column and no Draft Stage,
// not even an empty one. Seam 2: packages/db/test/rp-1219-visibility-rls.test.ts.
import type { WorkItemBoard } from "@rabaed/domain";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, buildTower, draft, ok, projectMember, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(async () => {
  await api.close();
});

let at: Tower;
let c2Engineer: Caller;
let k1Engineer: Caller;
let orMember: Caller;
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
const c1Drafts: Record<string, string> = {};
let c2Draft = "";

const kanban = async (by: Caller): Promise<WorkItemBoard> => (await ok(by.get(`/v1/projects/${at.projectId}/work-items/kanban`), 200)).json();
const draftColumn = (board: WorkItemBoard) => board.columns.find((c) => c.stageKey === "draft");
const draftCards = (board: WorkItemBoard) => (draftColumn(board)?.lanes ?? []).flatMap((l) => l.cards);
/** The Draft column `by` reads on the Kanban, by its Stage key: empty or not. */
const draftColumns = async (by: Caller) => (draftColumn(await kanban(by)) ? [{ id: "draft" }] : []);
/** The Draft-category Stages the Kanban gives `by` (its Stage field reads them), by key. */
const draftStages = async (by: Caller) => (await kanban(by)).stages.filter((s) => s.category === "draft").map((s) => ({ id: s.key }));
/** The Drafts `by` reads in the Kanban's Draft column. */
const inDraftColumn = async (by: Caller) => draftCards(await kanban(by)).map((c) => ({ id: c.id }));

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RDK");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  const or = await api.authorizedPerson();
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  orMember = await projectMember(api, or, orParticipant, []);
  for (const [by, name] of [
    [at.c1Engineer, "C1 engineer"],
    [c2Engineer, "C2 engineer"],
    [k1Engineer, "K1 engineer"],
    [at.k1Manager, "K1 manager"],
    [orMember, "OR Member with no Position"],
  ] as const)
    names.set(by, name);

  // Started in this order, so an order by when they were started would read Busbar, Cable, Anchor.
  for (const title of ["Busbar trunking", "Cable tray risers", "Anchor bolts"]) c1Drafts[title] = await draft(at, at.c1Engineer, title);
  c2Draft = await draft(at, c2Engineer, "Chilled water pumps");
});

describe("scenario RP-1219-1: the Kanban's Draft column, C1 and C2 raising Drafts on one Project with K1", () => {
  it("tells a Contractor's engineer they may raise, and gives them the Draft column first, of their own Drafts by Subject", async () => {
    const board = await kanban(at.c1Engineer);
    expect(board.mayRaise).toBe(true);
    expect(board.columns[0]?.stageKey).toBe("draft");
    expect(board.stages.some((s) => s.category === "draft")).toBe(true);
    expect(draftCards(board).map((c) => c.title)).toEqual(["Anchor bolts", "Busbar trunking", "Cable tray risers"]);
    expect(draftColumn(board)?.shown).toBe(3);
  });

  it("gives K1, who may raise no Submittal, no Draft column and no Draft Stage, not even an empty one", async () => {
    for (const by of [k1Engineer, at.k1Manager]) expect((await kanban(by)).mayRaise, named(by)).toBe(false);
    const k1 = [k1Engineer, at.k1Manager];
    // C1's engineer reads both first, the positive control.
    await expectHiddenFrom({ read: draftColumns, target: "draft", seenBy: [at.c1Engineer], hiddenFrom: k1, name: named, label: "the Draft column" });
    await expectHiddenFrom({ read: draftStages, target: "draft", seenBy: [at.c1Engineer], hiddenFrom: k1, name: named, label: "the Draft Stage" });
  });

  // Out of RP-1219's scope: the Snag List's board leaves Drafts out itself and keeps its Stage filter and total as they were.
  it("leaves the Snag List's board as it was: its Stages keep Draft for every Member, a raiser or not", async () => {
    const snags = async (by: Caller): Promise<WorkItemBoard> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items/kanban`), 200)).json();
    expect((await snags(at.c1Engineer)).mayRaise).toBe(true);
    // A Member of the Owner Representative with no Position may raise nothing in the Snag List.
    expect((await snags(orMember)).mayRaise).toBe(false);
    for (const by of [at.c1Engineer, orMember]) {
      const board = await snags(by);
      expect(board.stages.map((s) => s.category), named(by)).toContain("draft"); // not hidden-from: the Snag List's Stages, unchanged for everyone
    }
  });

  it("holds only the viewer's own Participant's Drafts: C1's to C1, C2's to C2, never another Contractor's", async () => {
    for (const id of Object.values(c1Drafts)) {
      await expectHiddenFrom({ read: inDraftColumn, target: id, seenBy: [at.c1Engineer], hiddenFrom: [c2Engineer, k1Engineer, at.k1Manager], name: named, label: "C1's Draft" });
    }
    await expectHiddenFrom({ read: inDraftColumn, target: c2Draft, seenBy: [c2Engineer], hiddenFrom: [at.c1Engineer, at.c1Pm, k1Engineer], name: named, label: "C2's Draft" });
  });
});
