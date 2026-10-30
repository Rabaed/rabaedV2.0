// Seam 1 for the Activity Feed (RP-353, spec RP-344; visibility.md "Activity
// Feed" and "Work Item history", V5, V14, V19, scenarios 34 and 35 through the
// feed). The feed is the Project's `work_item_event`s through the same rules
// as an item's history: another Participant's internal events and Internal Notes
// never reach it, another Company is named by its name only and its people never,
// and answer changes are left out for everyone. Paged by cursor, newest first,
// filtered by Module, Type and "items I'm on".
//
// A test-only Type runs on the Send Back test Workflow, whose Consultant has
// internal Steps (scenario 35). The raiser's changes to the answers after its Draft
// (answers_changed, internal to it) reach no feed. (Scenario 47, the Consultant's own
// Form Section, retired with ADR 0019, RP-437: the Consultant answers in its reply.)
import { randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { addTestWorkflow, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { activityFeedSearchParams, type ActivityFeed, type ActivityFeedEntry, type ActivityFeedQuery } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";
import { LEGACY_MAR } from "@rabaed/db/test-support";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARAF";
const C1_NAME = "Feed Contractor Co";
const K1_NAME = "Feed Consultants LLC";
const NOTE = "Internal: checked against the drawings";
const CHANGED = "Changed after the Return in the site office";

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

/** The test-only Type, on the Send Back test Workflow, with a new Form. */
async function addFeedType() {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Activity Feed (test)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const existing = await migrator.selectFrom("work_item_type").select("id").where("owner_kind", "=", "rabaed").where("code", "=", TYPE).executeTakeFirst();
  if (!existing) {
    const workflowId = await addTestWorkflow((text) => sql.raw(text).execute(migrator));
    await migrator
      .insertInto("work_item_type")
      .values({
        owner_kind: "rabaed",
        module_key: "submittals",
        code: TYPE,
        name: JSON.stringify(bilingual("Activity Feed submittal")),
        workflow_definition_id: workflowId,
        outcome_kind: "review_code",
        form_definition_id: formId,
      })
      .execute();
  }
  await migrator.updateTable("work_item_type").set({ form_definition_id: formId }).where("owner_kind", "=", "rabaed").where("code", "=", TYPE).execute();
  const published = await publishFormVersion(migrator, formId, schema);
  expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
}

let c1: Company;
let k1: Company;
let c2: Company;
let tower: Tower;
let k1Engineer: Caller;
let k1Pm: Caller;
let orEngineer: Caller;
let owner: Caller;
let c2Engineer: Caller;
let outsider: Caller;

const onboard = async (legalName: string): Promise<Company> => { // not hidden-from: the helper's parameter
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) }); // not hidden-from: onboarding the test Company
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

async function otherParticipant(company: Company, role: "consultant" | "contractor" | "owner" | "owner_representative") {
  const participantId = await api.addParticipant(c1.caller, tower.projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return participantId;
}

/** A new item of the test Type, at the C1 PM's Contractor review. */
async function atContractorReview(by: Caller, title: string): Promise<string> {
  const res = await ok(
    by.post(`/v1/projects/${tower.projectId}/work-items`, { type: TYPE, title, answers: { model: title, trade: tower.electrical, location: tower.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(by, id, "send_for_review");
  return id;
}

/** One page of `by`'s feed. */
async function page(by: Caller, query: Partial<ActivityFeedQuery> = {}, projectId = tower.projectId): Promise<ActivityFeed & { body: string }> {
  const res = await ok(by.get(`/v1/projects/${projectId}/activity?${activityFeedSearchParams(query)}`), 200);
  return { ...(res.json() as ActivityFeed), body: res.body };
}

/** Every entry of `by`'s feed, all pages, and everything the api said. */
async function feed(by: Caller, query: Partial<ActivityFeedQuery> = {}): Promise<{ entries: ActivityFeedEntry[]; body: string }> {
  const entries: ActivityFeedEntry[] = [];
  let body = "";
  let cursor: string | undefined;
  do {
    const p = await page(by, { limit: 100, ...query, ...(cursor ? { cursor } : {}) });
    entries.push(...p.entries);
    body += p.body;
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
  return { entries, body };
}

const ofItem = (entries: ActivityFeedEntry[], id: string) => entries.filter((e) => e.workItem.id === id);
const what = (e: ActivityFeedEntry) => [e.type, e.transition?.en ?? null, e.audience];

/** Something a viewer reads, for expectHiddenFrom: its rows by id. */
type Reader = { name: string; rows: () => Promise<{ id: string }[]> };
/** `target` is read by every Reader in `seenBy` first, and by none in `hiddenFrom` (RP-1095). */
const hiddenFrom = (target: string, seenBy: Reader | Reader[], hidden: Reader | Reader[], label: string) =>
  expectHiddenFrom({ read: (r: Reader) => r.rows(), target, seenBy, hiddenFrom: hidden, name: (r) => r.name, label });
/** `by`'s whole feed: its events, by id. */
const eventsIn = (by: Caller, name: string): Reader => ({ name: `${name}'s feed`, rows: async () => (await feed(by)).entries });
/** The same, read once: a check over many events reads each feed one time, not once an event. */
const eventsRead = (by: Caller, name: string): Reader => {
  let once: Promise<ActivityFeedEntry[]> | undefined;
  return { name: `${name}'s feed`, rows: () => (once ??= feed(by).then((f) => f.entries)) };
};
/** The items `by`'s feed names, by id. */
const itemsIn = (by: Caller, name: string): Reader => ({ name: `${name}'s feed`, rows: async () => (await feed(by)).entries.map((e) => ({ id: e.workItem.id })) });
/** `text`, as the one row of a body that holds it. */
const textIn = (name: string, body: () => Promise<string>, text: string): Reader => ({ name, rows: async () => ((await body()).includes(text) ? [{ id: text }] : []) });
const feedText = (by: Caller, name: string, text: string) => textIn(`${name}'s feed`, async () => (await feed(by)).body, text);
const historyText = (by: Caller, id: string, name: string, text: string) =>
  textIn(`${name}'s history of the item`, async () => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).body, text);

beforeAll(async () => {
  await addFeedType();
  c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  k1 = await onboard(K1_NAME);
  c2 = await onboard("Feed Second Contractor");
  tower = await buildTower(api, { c1, k1 }, "FEED");
  // C1 is the Project Admin, and sees every Participant.
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { company: { legalName: { en: string } } }) => p.company.legalName.en === K1_NAME).id as string; // not hidden-from: the setup finds K1's Participant by its name
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  k1Pm = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  const or = await onboard("Feed Owner Representative");
  orEngineer = await projectMember(api, or, await otherParticipant(or, "owner_representative"), ["engineer"]);
  const ow = await onboard("Feed Owner");
  owner = await projectMember(api, ow, await otherParticipant(ow, "owner"), ["representative"]);
  const c2ParticipantId = await otherParticipant(c2, "contractor");
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  // Send for Review needs a Project Manager in the pool.
  await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  outsider = (await api.authorizedPerson()).caller;
});

describe("scenario 34 through the feed: C1 PM Submits with an Internal Note", () => {
  let id = "";
  beforeAll(async () => {
    id = await atContractorReview(tower.c1Engineer, "Feed FD-34");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit", { internalNote: NOTE });
  });

  it("shows K1 and OR the Submit, by C1's name only, and never the Internal Note", async () => {
    for (const other of [tower.k1Manager, orEngineer]) {
      const { entries } = await feed(other);
      expect(ofItem(entries, id).map(what)).toEqual([["transition", "Submit", "shared"]]);
      expect(ofItem(entries, id)[0]).toMatchObject({ by: { companyName: bilingual(C1_NAME), memberName: null } });
    }
    // The Note's text is in C1's own history of the item; no K1 or OR feed holds it.
    await hiddenFrom(NOTE, historyText(tower.c1Pm, id, "C1 PM", NOTE), [feedText(tower.k1Manager, "K1", NOTE), feedText(orEngineer, "OR", NOTE)], "the Internal Note");
  });

  it("shows C1 its own moves, newest first, with its people's names, but not the Note's text", async () => {
    const { entries } = await feed(tower.c1Pm);
    expect(ofItem(entries, id).map(what)).toEqual([
      ["transition", "Submit", "shared"],
      ["internal_note", "Submit", "internal"],
      // C1's only PM held it at once (§3.3 rule 4): no Pick up.
      ["assigned", null, "internal"],
      ["transition", "Send for Review", "internal"],
    ]);
    const submit = ofItem(entries, id)[0]!;
    expect(submit.by.companyName).toEqual(bilingual(C1_NAME));
    expect(submit.by.memberName).not.toBeNull();
    expect(submit.workItem).toMatchObject({ id, title: "Feed FD-34", type: { code: TYPE } });
    expect(submit.workItem.documentNumber).toMatch(/^FEED-/);
    // The feed names the internal_note event, never its text, which C1's history of the item holds.
    await hiddenFrom(NOTE, historyText(tower.c1Pm, id, "C1 PM", NOTE), feedText(tower.c1Pm, "C1 PM", NOTE), "the Internal Note's text");
  });
});

describe("scenario 35 through the feed: K1 moves the Submitted item internally", () => {
  let id = "";
  beforeAll(async () => {
    id = await atContractorReview(tower.c1Engineer, "Feed FD-35");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_to_manager");
    await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.k1Manager, id, "return_to_engineer");
  });

  it("shows C1 only its own events: no K1 internal move, no K1 name", async () => {
    const { entries } = await feed(tower.c1Pm);
    for (const e of ofItem(entries, id)) expect(e.by.companyName).toEqual(bilingual(C1_NAME));
    // K1's two internal moves are K1's feed's events; neither reaches C1's.
    const k1Moves = ofItem((await feed(tower.k1Manager)).entries, id).filter((e) => e.audience === "internal" && e.type === "transition");
    expect(k1Moves.map((e) => e.transition?.en)).toEqual(["Return to Engineer", "Send to Manager"]);
    for (const move of k1Moves) await hiddenFrom(move.id, eventsIn(tower.k1Manager, "K1"), eventsIn(tower.c1Pm, "C1 PM"), `K1's ${move.transition?.en}`);
    for (const text of [K1_NAME, "Return to Engineer"]) await hiddenFrom(text, feedText(tower.k1Manager, "K1", text), feedText(tower.c1Pm, "C1 PM", text), `"${text}"`);
  });

  it("shows K1 its own internal moves, with its people's names", async () => {
    const { entries } = await feed(tower.k1Manager);
    const moves = ofItem(entries, id).filter((e) => e.type === "transition");
    expect(moves.map(what)).toEqual([
      ["transition", "Return to Engineer", "internal"],
      ["transition", "Send to Manager", "internal"],
      ["transition", "Submit", "shared"],
    ]);
    expect(moves[0]!.by).toMatchObject({ companyName: bilingual(K1_NAME) });
    expect(moves[0]!.by.memberName).not.toBeNull();
    // C1's people stay C1's (V14).
    expect(moves[2]!.by.memberName).toBeNull();
  });
});

describe("answer changes through the feed: C1 changes its Returned item twice", () => {
  let id = "";
  beforeAll(async () => {
    id = await atContractorReview(tower.c1Engineer, "Feed FD-47");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "return");
    const save = async (changes: Record<string, unknown>) =>
      ok(tower.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(tower.c1Engineer, id)).answers, ...changes } }));
    await save({ model: "FD-48" });
    await save({ model: CHANGED });
    // C1's own history holds both changes: the feed leaves them out for everyone.
    const history = (await ok(tower.c1Engineer.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string }[];
    expect(history.filter((e) => e.type === "answers_changed")).toHaveLength(2); // not hidden-from: C1's own history of its own item, the setup's proof of two changes
  });

  it("gives no answers_changed to C1 itself, K1, OR or OW", async () => {
    // Each feed is read once for all of the events below: a read a change would be six pages a change.
    const feeds = [
      eventsRead(tower.c1Engineer, "C1 engineer"),
      eventsRead(tower.c1Pm, "C1 PM"),
      eventsRead(orEngineer, "OR"),
      eventsRead(owner, "OW"),
      eventsRead(k1Engineer, "K1 engineer"),
      eventsRead(k1Pm, "K1 PM"),
    ];
    // The Project's answers_changed events, this item's two among them: no feed holds any.
    let eventRows: Promise<{ id: string }[]> | undefined;
    const events: Reader = {
      name: "the Project's events",
      rows: () =>
        (eventRows ??= migrator
          .selectFrom("work_item_event")
          .innerJoin("work_item", "work_item.id", "work_item_event.work_item_id")
          .select("work_item_event.id")
          .where("work_item.project_id", "=", tower.projectId)
          .where("work_item_event.type", "=", "answers_changed")
          .execute()),
    };
    const changes = await events.rows();
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (const change of changes) await hiddenFrom(change.id, events, feeds, "answers_changed");
    // The changed answer is the item's to C1, in its detail; no feed's text holds it.
    const changedIn = (by: Caller, name: string) => feedText(by, name, CHANGED);
    await hiddenFrom(
      CHANGED,
      textIn("C1 engineer's item detail", async () => (await ok(tower.c1Engineer.get(`/v1/work-items/${id}`), 200)).body, CHANGED),
      [changedIn(tower.c1Engineer, "C1 engineer"), changedIn(tower.c1Pm, "C1 PM"), changedIn(orEngineer, "OR"), changedIn(owner, "OW"), changedIn(k1Engineer, "K1 engineer"), changedIn(k1Pm, "K1 PM")],
      "the changed answer",
    );
  });
});

describe("another Contractor", () => {
  let own = "";
  beforeAll(async () => {
    own = await atContractorReview(c2Engineer, "Feed C2's own");
  });

  it("holds nothing of C1's in a C2 Member's feed", async () => {
    const { entries } = await feed(c2Engineer);
    expect(new Set(entries.map((e) => e.workItem.id))).toEqual(new Set([own]));
    // K1's feed names C1; C2's never does.
    await hiddenFrom(C1_NAME, feedText(tower.k1Manager, "K1", C1_NAME), feedText(c2Engineer, "C2", C1_NAME), "C1's name");
  });

  it("holds nothing of C2's in C1's, K1's or OR's feed while it is C2's Draft (V1)", async () => {
    await hiddenFrom(own, itemsIn(c2Engineer, "C2"), [itemsIn(tower.c1Pm, "C1 PM"), itemsIn(tower.k1Manager, "K1"), itemsIn(orEngineer, "OR")], "C2's Draft");
  });

  it("answers a C1 item C2 reached by link with a 404, as one that doesn't exist", async () => {
    const c1Item = (await feed(tower.c1Pm)).entries[0]!.workItem.id;
    const item = (path: string) => async (by: Caller) => (await readById(path)(by)).map(() => ({ id: c1Item }));
    for (const path of [`/v1/work-items/${c1Item}`, `/v1/work-items/${c1Item}/history`]) {
      await expectHiddenFrom({ read: item(path), target: c1Item, seenBy: tower.c1Pm, hiddenFrom: c2Engineer, name: (by) => (by === c2Engineer ? "C2" : "C1 PM"), label: path });
    }
  });

  it("answers a Project the caller isn't on with a 404", async () => {
    const feedOf = (projectId: string) => async (by: Caller) => (await readById(`/v1/projects/${projectId}/activity`)(by)).map(() => ({ id: projectId }));
    await expectHiddenFrom({ read: feedOf(tower.projectId), target: tower.projectId, seenBy: tower.c1Pm, hiddenFrom: outsider, name: (by) => (by === outsider ? "outsider" : "C1 PM") });
    // A made-up Project gets the same 404, from someone whose own Project's feed is read.
    await expectHiddenFrom({ read: (projectId: string) => feedOf(projectId)(tower.c1Pm).then((rows) => rows.map(() => ({ id: "a feed" }))), target: "a feed", seenBy: tower.projectId, hiddenFrom: randomUUID() });
  });
});

describe("paging and filters", () => {
  let marId = "";
  let k1Acted = "";
  beforeAll(async () => {
    // A MAR, a second Type in the same Module.
    marId = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Feed MAR");
    // An item K1's engineer acts on; the MAR no K1 engineer touches (K1's only manager holds it).
    k1Acted = await atContractorReview(tower.c1Engineer, "Feed K1 acts");
    await ok(tower.c1Pm.post(`/v1/work-items/${k1Acted}/pick-up`));
    await take(tower.c1Pm, k1Acted, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${k1Acted}/pick-up`));
    await take(k1Engineer, k1Acted, "send_to_manager");
  });

  it("returns each visible event once, newest first, whatever the page size", async () => {
    for (const by of [tower.c1Pm, tower.k1Manager]) {
      const whole = (await page(by, { limit: 100 })).entries;
      expect(whole.length).toBeGreaterThan(10);
      expect(whole.length).toBeLessThan(100);
      for (const limit of [1, 3, 7]) {
        const { entries } = await feed(by, { limit });
        expect(entries.map((e) => e.id)).toEqual(whole.map((e) => e.id));
      }
      const times = whole.map((e) => e.at);
      expect([...times].sort().reverse()).toEqual(times);
    }
  });

  it("names the Project's Types by Module for its filters, with no counts", async () => {
    const { types } = await page(tower.c1Pm, {});
    expect(types).toEqual(expect.arrayContaining([{ code: "MAR", name: expect.objectContaining({ en: "Material Approval Request" }), moduleKey: "submittals" }]));
    expect(types.map((t) => t.code)).toContain(TYPE);
    for (const t of types) expect(Object.keys(t).toSorted()).toEqual(["code", "moduleKey", "name"]);
  });

  it("filters by Module and by Type, and combines them", async () => {
    const everything = (await feed(tower.c1Pm)).entries;
    expect((await feed(tower.c1Pm, { module: "submittals" })).entries).toEqual(everything);
    expect((await feed(tower.c1Pm, { module: "inspections" })).entries).toEqual([]); // not hidden-from: a Module filter; the Project has no Inspections
    const mars = (await feed(tower.c1Pm, { type: [LEGACY_MAR] })).entries;
    expect(new Set(mars.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    expect((await feed(tower.c1Pm, { type: [LEGACY_MAR, TYPE] })).entries).toEqual(everything);
    expect((await feed(tower.c1Pm, { module: "inspections", type: [LEGACY_MAR] })).entries).toEqual([]); // not hidden-from: Module and Type filters that exclude each other
  });

  it("keeps \"items I'm on\" to the ones I raised, held or acted on, combined with the other filters", async () => {
    // K1's engineer acted on (and held) the scenario items and k1Acted; the K1 PM acted on none.
    const engineerOn = new Set((await feed(k1Engineer, { mine: true })).entries.map((e) => e.workItem.id));
    expect(engineerOn).toContain(k1Acted);
    expect(engineerOn).not.toContain(marId); // not hidden-from: the "items I'm on" filter; K1's engineer sees the MAR in the whole feed
    expect((await feed(k1Engineer, { mine: true, type: [LEGACY_MAR] })).entries).toEqual([]); // not hidden-from: the "items I'm on" filter with a Type filter
    // The manager held and acted on the scenario 35 item, and holds k1Acted and the MAR:
    // K1's only manager holds a Step whose pool is them alone at once (§3.3 rule 4).
    const managerOn = new Set((await feed(tower.k1Manager, { mine: true })).entries.map((e) => e.workItem.id));
    expect(managerOn.size).toBe(3);
    expect(managerOn).toContain(k1Acted);
    expect(managerOn).toContain(marId);
    // C1's engineer raised every C1 item: the MAR among them.
    expect(new Set((await feed(tower.c1Engineer, { mine: true, type: [LEGACY_MAR] })).entries.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    // Nobody at the Owner acted on anything.
    expect((await feed(owner, { mine: true })).entries).toEqual([]); // not hidden-from: the "items I'm on" filter; the Owner reads the items, acted on none
  });

  it("takes in the items I watch (RP-354), and lets them go when I stop watching", async () => {
    await ok(owner.request("PUT", `/v1/work-items/${marId}/watch`));
    const watched = (await feed(owner, { mine: true })).entries;
    expect(new Set(watched.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    expect(watched).toEqual((await feed(owner, { type: [LEGACY_MAR] })).entries);
    await ok(owner.delete(`/v1/work-items/${marId}/watch`));
    expect((await feed(owner, { mine: true })).entries).toEqual([]); // not hidden-from: the "items I'm on" filter once the Owner stops watching
  });

  it("refuses a tampered cursor or a filter that isn't one", async () => {
    const next = (await page(tower.c1Pm, { limit: 1 })).nextCursor!;
    const tampered = Buffer.from(JSON.stringify(["activity", "2026-10-01T00:00:00Z"])).toString("base64url");
    for (const query of [`cursor=${tampered}`, `cursor=${next.slice(0, -2)}`, "cursor=garbage", "module=schedule", "type=bad%20code", "limit=0"]) {
      const res = await tower.c1Pm.get(`/v1/projects/${tower.projectId}/activity?${query}`);
      expect(res.statusCode, query).toBe(400);
    }
  });
});
