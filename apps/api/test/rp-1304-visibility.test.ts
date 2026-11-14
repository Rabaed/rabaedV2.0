// Seam 1 for the "Whole Project" Location (RP-1304; GLOSSARY › Location; data-model.md §3; visibility.md row 4,
// V12, V16, V19; scenarios RP-1304-1 to RP-1304-7). Every Project has one, listed first, above the Zones. An item
// there is covered by any Location (owner's decision on RP-1304, 2026-11-14): within the Companies that already see
// it, a Member whose Visibility covers any Location sees it in the item, the List and the Kanban, while its Trade must
// still be covered. It is never a grant's value, and the Settings neither rename nor archive it.
// Seam 2: packages/db/test/rp-1304-visibility-rls.test.ts.
import { createDb } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type DimensionValue, type DimensionValues, type MemberVisibility, type ParticipantVisibility, type WorkItemBoard, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
// The worker connects as the app role, with no Member set (the Vacancy hand-off's notices).
const worker = createDb(testDatabaseUrls().app, { max: 2 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
  await worker.destroy();
});

const SENT_BACK = "WPSBK";

let at: Tower;
let c1: Company;
let k1: Company;
let c3: Company;
let c2Engineer: Caller; // C2, a Contractor on the Project covering every Trade and Building B, never sent the item.
let c2: Company;
let buildingB = "";
let wholeProject = "";
let blockA: Caller; // K1's engineer on Electrical and Building A only.
let otherTrade: Caller; // K1's engineer on Mechanical and Building A.
let noLocation: Caller; // K1's engineer on Electrical and no Location.
let item = ""; // C1's MAR at the Whole Project, Electrical, Submitted to K1.
let blockAItem = ""; // C1's MAR at Building A, for the filter.

type Viewer = { by: Caller; name: string };
const viewer = (by: Caller, name: string): Viewer => ({ by, name });

const dimensions = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}/dimensions`), 200)).json() as DimensionValues;
const mine = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}/visibility`), 200)).json() as DimensionValues;
const listPath = (location: string[] = []) => `/v1/projects/${at.projectId}/modules/submittals/work-items?${workItemSearchParams({ location })}`;
const kanbanPath = () => `/v1/projects/${at.projectId}/modules/submittals/work-items/kanban`;
const list = async (by: Caller, location: string[] = []) => (await ok(by.get(listPath(location)), 200)).json() as WorkItemList;
const cards = (board: WorkItemBoard) => board.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
/** The ids in `by`'s List and Kanban; none, with the 404 that names nothing, for someone not on the Project. */
async function listedAndCarded(by: Caller, name: string): Promise<{ listed: string[]; carded: string[] }> {
  const [rows, board] = [await by.get(listPath()), await by.get(kanbanPath())];
  if (rows.statusCode === 404) {
    await expectHidden(rows, name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
    await expectHidden(board, name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
    return { listed: [], carded: [] };
  }
  return { listed: (rows.json() as WorkItemList).items.map((i) => i.id), carded: cards(board.json() as WorkItemBoard).map((c) => c.id) };
}
const setMember = (member: string, body: unknown) => k1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/members/${member}/visibility`, body);

/** What `v` reads of item `id`: the item page, its List row and its Kanban card, each of them or none. */
const readsEverywhere = (id: string) => async (v: Viewer) => {
  const res = await v.by.get(`/v1/work-items/${id}`);
  const { listed, carded } = await listedAndCarded(v.by, v.name);
  if (res.statusCode !== 200) {
    await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
    expect(listed, v.name).not.toContain(id); // not hidden-from: the same read's List, inside expectHiddenFrom
    expect(carded, v.name).not.toContain(id); // not hidden-from: the same read's Kanban, inside expectHiddenFrom
    return [];
  }
  expect(listed, v.name).toContain(id);
  expect(carded, v.name).toContain(id);
  return [{ id: (await detail(v.by, id)).id }];
};

/** The test Type's Form: a Send Back to C1's Draft reopens it (addSendBackType). */
const sentBackSchema = {
  sections: [
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

beforeAll(async () => {
  await addSendBackType(migrator, SENT_BACK, bilingual("Whole Project send back (test)"), sentBackSchema, {
    afterSendBack: { draft: "edit_form", internal_review: "edit_form" },
  });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c3 = await api.projectCreator();
  at = await buildTower(api, { c1, k1 }, "RWA");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  wholeProject = (await dimensions(c1.caller)).location.find((l) => l.wholeProject)!.id;
  const k1Member = async (trade: string, location: string[]) => {
    const m = await memberOnProject(api, k1, at.k1ParticipantId!, ["engineer"], { trade: only(trade) });
    await ok(setMember(m.id, { trade: only(trade), location: only(...location), handovers: [] }));
    return m.caller;
  };
  blockA = await k1Member(at.electrical, [at.buildingA]);
  otherTrade = await k1Member(at.mechanical, [at.buildingA]);
  noLocation = await k1Member(at.electrical, []);
  await api.createProject(c3.caller, { code: "RWO" });
  // `submitted` raises at the Location it is given as `buildingA`: here, the Whole Project.
  item = await submitted({ ...at, buildingA: wholeProject }, at.c1Engineer, at.c1Pm, "General specification");
  blockAItem = await submitted(at, at.c1Engineer, at.c1Pm, "Cable tray, Building A");
  c2 = await api.authorizedPerson();
  const c2Id = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Id}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = (await memberOnProject(api, c2, c2Id, ["engineer"])).caller;
});

describe("scenario RP-1304-1: the Whole Project Location is listed first and is built in", () => {
  it("is every Project Member's first Location, above the Zones, in English and Arabic", async () => {
    for (const by of [c1.caller, at.c1Engineer, at.k1Manager]) {
      const [first, ...rest] = (await dimensions(by)).location;
      expect(first).toMatchObject({ parentId: null, depth: 1, code: "WP", name: { en: "Whole Project", ar: "المشروع كامل" }, active: true, wholeProject: true });
      expect(rest.map((l) => l.id)).toEqual([at.buildingA, buildingB]);
      expect(rest.some((l: DimensionValue) => l.wholeProject)).toBe(false);
    }
  });

  it("is the first Location a Form offers a Member covering Building A only, and not one covering none", async () => {
    expect((await mine(blockA)).location.map((l) => l.id)).toEqual([wholeProject, at.buildingA]);
    expect((await mine(noLocation)).location).toEqual([]); // not hidden-from: the Member's own coverage, no Location granted (state)
  });

  it("is never renamed, archived or given a Location inside it", async () => {
    await expectHidden(c1.caller.request("PATCH", `/v1/locations/${wholeProject}`, { name: bilingual("Site") })); // not hidden-from: built in, refused as no value of the dimension
    await expectHidden(c1.caller.request("PATCH", `/v1/locations/${wholeProject}`, { active: false })); // not hidden-from: built in, refused as no value of the dimension
    const inside = await c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "B1", name: bilingual("Inside"), parentId: wholeProject });
    expect([inside.statusCode, inside.json().error]).toEqual([422, "parent_not_found"]);
  });

  it("is no value a grant lists, and no Participant's covered values name it", async () => {
    const refused = await c1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/visibility`, { trade: all, location: only(wholeProject), handovers: [] });
    expect([refused.statusCode, refused.json().error]).toEqual([422, "value_not_found"]);
    const covered = (await ok(k1.caller.get(`/v1/participants/${at.k1ParticipantId}/visibility`), 200)).json() as ParticipantVisibility;
    expect(covered.covered.location.map((l) => l.id)).toEqual([at.buildingA, buildingB]);
  });
});

describe("scenario RP-1304-2: a Building A-only engineer sees a Whole Project item of a Trade they cover", () => {
  it("reads it in the item page, the List and the Kanban, its Location named", async () => {
    await expectHiddenFrom({
      read: readsEverywhere(item),
      target: item,
      seenBy: [viewer(blockA, "K1's Building A engineer"), viewer(at.k1Manager, "K1's manager"), viewer(at.c1Engineer, "C1's engineer")],
      hiddenFrom: [viewer(otherTrade, "K1's Mechanical engineer"), viewer(noLocation, "K1's engineer with no Location"), viewer(c3.caller, "another Project's Authorized Person")],
      name: (v: Viewer) => v.name,
      label: "a Whole Project item",
    });
    expect((await detail(blockA, item)).location).toMatchObject({ id: wholeProject, code: "WP", name: { en: "Whole Project", ar: "المشروع كامل" } });
    expect((await list(blockA)).items.find((i) => i.id === item)?.location).toMatchObject({ id: wholeProject, code: "WP" });
  });

  it("is a filter value of its own, in the List's Zone filter beside the Zones", async () => {
    const levels = (await list(c1.caller)).filters.locations;
    expect(levels.find((l) => l.id === wholeProject)).toMatchObject({ parentId: null, depth: 1, name: { en: "Whole Project" } });
    const ids = async (location: string[]) => (await list(at.k1Manager, location)).items.map((i) => i.id).sort();
    expect(await ids([wholeProject])).toEqual([item]);
    expect(await ids([at.buildingA])).toEqual([blockAItem]);
    expect(await ids([wholeProject, at.buildingA])).toEqual([item, blockAItem].sort());
    // The Kanban reads the same filter.
    const board = (await ok(at.k1Manager.get(`${kanbanPath()}?${workItemSearchParams({ location: [wholeProject] })}`), 200)).json() as WorkItemBoard;
    expect(cards(board).map((c) => c.id)).toEqual([item]);
  });
});

describe("scenario RP-1304-3: not when the Member's Trade isn't the item's, or they cover no Location", () => {
  it("is not read by K1's engineer on Mechanical and Building A, or on Electrical with no Location", async () => {
    await expectHiddenFrom({
      read: readsEverywhere(item),
      target: item,
      seenBy: viewer(blockA, "K1's Building A engineer"),
      hiddenFrom: [viewer(otherTrade, "K1's Mechanical engineer on Building A"), viewer(noLocation, "K1's engineer with no Location")],
      name: (v: Viewer) => v.name,
      label: "a Whole Project item, to another Trade or no Location",
    });
  });

  it("is not read by C1's Members while C1 covers no Location, though their own grants are all of it", async () => {
    // C1's own Participant: its Members hold no Step now, so nothing is handed over.
    await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: all, location: only(), handovers: [] }));
    await expectHiddenFrom({
      read: readsEverywhere(item),
      target: item,
      seenBy: viewer(at.k1Manager, "K1's manager"),
      hiddenFrom: [viewer(at.c1Engineer, "C1's engineer, who raised it"), viewer(at.c1Pm, "C1's Project Manager")],
      name: (v: Viewer) => v.name,
      label: "a Whole Project item, to a Participant covering no Location",
    });
    await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: all, location: all, handovers: [] }));
  });
});

describe("scenario RP-1304-4: the Company rules are unchanged: who couldn't see it still can't", () => {
  it("is not read by C2, which covers every Trade and Building B but was never sent it, or another Project's Company", async () => {
    await expectHiddenFrom({
      read: readsEverywhere(item),
      target: item,
      seenBy: viewer(at.k1Manager, "K1's manager"),
      hiddenFrom: [viewer(c2Engineer, "C2's engineer"), viewer(c2.caller, "C2's Authorized Person"), viewer(c3.caller, "another Project's Authorized Person and Admin")],
      name: (v: Viewer) => v.name,
      label: "a Whole Project item, to another Company",
    });
  });
});

describe("scenario RP-1304-7: Sent Back, K1 reads it as it arrived (V19): at the Whole Project", () => {
  let sentBack = "";

  beforeAll(async () => {
    const answers = { model: "General specification", trade: at.electrical, location: wholeProject };
    sentBack = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: SENT_BACK, title: "General specification", answers }), 201)).json().id;
    await take(at.c1Engineer, sentBack, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${sentBack}/pick-up`));
    await take(at.c1Pm, sentBack, "submit");
    await ok(at.k1Manager.post(`/v1/work-items/${sentBack}/pick-up`));
    await take(at.k1Manager, sentBack, "send_back_to_draft");
    // C1's engineer moves it to Building B, which K1's Building A engineer doesn't cover, before Submitting again.
    const now = await detail(at.c1Engineer, sentBack);
    await ok(at.c1Engineer.request("PUT", `/v1/work-items/${sentBack}/answers`, { answers: { ...now.answers, location: buildingB } }));
  });

  it("is read by K1's Building A engineer at the Whole Project, as it arrived, while C1 has it at Building B", async () => {
    expect((await detail(at.c1Engineer, sentBack)).location?.id).toBe(buildingB);
    await expectHiddenFrom({
      read: async (v: Viewer) => {
        const res = await v.by.get(`/v1/work-items/${sentBack}`);
        if (res.statusCode !== 200) {
          await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
          return [];
        }
        return [{ id: (await detail(v.by, sentBack)).id }];
      },
      target: sentBack,
      seenBy: viewer(blockA, "K1's Building A engineer"),
      hiddenFrom: [viewer(noLocation, "K1's engineer with no Location"), viewer(otherTrade, "K1's Mechanical engineer")],
      name: (v: Viewer) => v.name,
      label: "a Sent Back item that arrived at the Whole Project",
    });
    expect((await detail(blockA, sentBack)).location?.id).toBe(wholeProject);
  });
});

// RP-1304-5 and RP-1304-6 on a Project of their own: C1's Whole Project item, held by Consultant KA when C1's
// Project Admin withdraws it, passes to KB once KB covers Electrical and any Location; then narrowing KB leaves a
// Member on Building A only with no Location at all.
describe("on another Project, the Vacancy hand-off and narrowing", () => {
  let projectId = "";
  let electrical = "";
  let buildingA2 = "";
  let buildingB2 = "";
  let wholeProject2 = "";
  let kbId = "";
  let kb: Company;
  let kbEngineer: Caller;
  let raiser: Caller; // C1's engineer on this Project: reads the item throughout.
  let vacant = "";

  const reads = (id: string) => async (v: Viewer) => {
    const res = await v.by.get(`/v1/work-items/${id}`);
    if (res.statusCode !== 200) {
      await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
      return [];
    }
    return [{ id: (await detail(v.by, id)).id }];
  };
  const setKb = (body: unknown) => c1.caller.request("PUT", `/v1/participants/${kbId}/visibility`, body);

  beforeAll(async () => {
    projectId = (await api.createProject(c1.caller, { code: "RWV" })).id;
    const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
    electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
    buildingA2 = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
    buildingB2 = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
    wholeProject2 = ((await ok(c1.caller.get(`/v1/projects/${projectId}/dimensions`), 200)).json() as DimensionValues).location.find((l) => l.wholeProject)!.id;
    const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
    const engineer = await memberOnProject(api, c1, own, ["engineer"]);
    raiser = engineer.caller;
    const pm = await memberOnProject(api, c1, own, ["project_manager"]);
    const ka = await api.authorizedPerson();
    const kaId = await api.addParticipant(c1.caller, projectId, ka.company, "consultant");
    await ok(c1.caller.request("PUT", `/v1/participants/${kaId}/visibility`, { trade: all, location: all }));
    const kaEngineer = await memberOnProject(api, ka, kaId, ["engineer"]);
    const answers = { model: "General specification", trade: electrical, location: wholeProject2 };
    vacant = (await ok(engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: SENT_BACK, title: "General specification", answers }), 201)).json().id;
    await take(engineer.caller, vacant, "send_for_review");
    await ok(pm.caller.post(`/v1/work-items/${vacant}/pick-up`));
    await take(pm.caller, vacant, "submit");
    await ok(kaEngineer.caller.post(`/v1/work-items/${vacant}/pick-up`));
    await ok(c1.caller.post(`/v1/participants/${kaId}/withdraw`));
    await drainOutbox(worker);
    kb = await api.authorizedPerson();
    kbId = await api.addParticipant(c1.caller, projectId, kb.company, "consultant");
    kbEngineer = (await memberOnProject(api, kb, kbId, ["engineer"])).caller;
  });

  describe("scenario RP-1304-6: a Consultant covering any Location and the Trade takes a withdrawn one's Whole Project item (RP-1262)", () => {
    it("stays a Vacancy while KB covers Electrical and no Location, hidden from KB", async () => {
      await ok(setKb({ trade: only(electrical), location: only() }));
      await drainOutbox(worker);
      expect((await detail(raiser, vacant)).vacancy?.projectRole.baseRole).toBe("consultant");
      await expectHiddenFrom({
        read: reads(vacant),
        target: vacant,
        seenBy: viewer(raiser, "C1's engineer"),
        hiddenFrom: [viewer(kbEngineer, "KB's engineer"), viewer(kb.caller, "KB's Authorized Person")],
        name: (v: Viewer) => v.name,
        label: "a Whole Project Vacancy, before KB covers a Location",
      });
    });

    it("passes to KB once it covers Building B: KB's engineer holds it", async () => {
      await ok(setKb({ trade: only(electrical), location: only(buildingB2) }));
      await drainOutbox(worker);
      const held = await detail(kbEngineer, vacant);
      expect(held.vacancy ?? null).toBeNull();
      expect(held.heldBy?.memberName).not.toBeNull();
      expect(held.location?.id).toBe(wholeProject2);
    });
  });

  describe("scenario RP-1304-5: narrowing a Participant never leaves a Member with the Whole Project alone", () => {
    it("leaves KB's Member on Building A with no Location once KB is narrowed to Building B, and they read nothing", async () => {
      await ok(setKb({ trade: only(electrical), location: only(buildingA2, buildingB2) }));
      const blockAOnly = await memberOnProject(api, kb, kbId, ["engineer"], { trade: only(electrical) });
      await ok(kb.caller.request("PUT", `/v1/participants/${kbId}/members/${blockAOnly.id}/visibility`, { trade: only(electrical), location: only(buildingA2), handovers: [] }));
      await expectHiddenFrom({
        read: reads(vacant),
        target: vacant,
        seenBy: viewer(blockAOnly.caller, "KB's Building A engineer"),
        hiddenFrom: viewer(c3.caller, "another Project's Authorized Person"),
        name: (v: Viewer) => v.name,
        label: "a Whole Project item, before the narrowing",
      });
      await ok(setKb({ trade: only(electrical), location: only(buildingB2) }));
      const grant = (await ok(kb.caller.get(`/v1/participants/${kbId}/members/${blockAOnly.id}/visibility`), 200)).json() as MemberVisibility;
      expect(grant.visibility.location).toEqual({ isAll: false, valueIds: [] });
      await expectHiddenFrom({
        read: reads(vacant),
        target: vacant,
        seenBy: viewer(kbEngineer, "KB's engineer, who holds it"),
        hiddenFrom: viewer(blockAOnly.caller, "KB's engineer narrowed out of every Location"),
        name: (v: Viewer) => v.name,
        label: "a Whole Project item, after the narrowing",
      });
    });
  });
});
