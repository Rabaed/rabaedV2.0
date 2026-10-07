// Seam 1 for the Activity Feed (RP-353, spec RP-344; visibility.md "Activity
// Feed" and "Work Item history", V5, V14, V19, scenarios 34, 35 and 47 through
// the feed). The feed is the Project's `work_item_event`s through the same rules
// as an item's history: another Participant's internal events and Internal Notes
// never reach it, another Company is named by its name only and its people never,
// and answer changes are left out for everyone. Paged by cursor, newest first,
// filtered by Module, Type and "items I'm on".
//
// A test-only Type runs on the Send Back test Workflow, whose Consultant has
// internal Steps (scenario 35), with a Form whose "Consultant verification"
// section the Consultant fills at its own Step (scenario 47).
import { randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { addSendBackWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import { activityFeedSearchParams, type ActivityFeed, type ActivityFeedEntry, type ActivityFeedQuery } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

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
const VERIFICATION = "Matches the sample in the site office";

const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "verification",
      title: bilingual("Consultant verification"),
      editable_at: ["consultant_review"],
      fields: [
        { key: "sample_checked", type: "yes_no", label: bilingual("Sample checked") },
        { key: "verification_note", type: "textarea", label: bilingual("Verification note") },
      ],
    },
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
    const workflowId = await addSendBackWorkflow((text) => sql.raw(text).execute(migrator));
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

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
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
    .participants.find((p: { company: { legalName: { en: string } } }) => p.company.legalName.en === K1_NAME).id as string;
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
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(tower.c1Pm, id, "submit", { internalNote: NOTE });
  });

  it("shows K1 and OR the Submit, by C1's name only, and never the Internal Note", async () => {
    for (const other of [tower.k1Manager, orEngineer]) {
      const { entries, body } = await feed(other);
      expect(ofItem(entries, id).map(what)).toEqual([["transition", "Submit", "shared"]]);
      expect(ofItem(entries, id)[0]).toMatchObject({ by: { companyName: bilingual(C1_NAME), memberName: null } });
      expect(body).not.toContain(NOTE);
    }
  });

  it("shows C1 its own moves, newest first, with its people's names, but not the Note's text", async () => {
    const { entries, body } = await feed(tower.c1Pm);
    expect(ofItem(entries, id).map(what)).toEqual([
      ["transition", "Submit", "shared"],
      ["internal_note", "Submit", "internal"],
      ["claimed", null, "internal"],
      ["transition", "Send for Review", "internal"],
    ]);
    const submit = ofItem(entries, id)[0]!;
    expect(submit.by.companyName).toEqual(bilingual(C1_NAME));
    expect(submit.by.memberName).not.toBeNull();
    expect(submit.workItem).toMatchObject({ id, title: "Feed FD-34", type: { code: TYPE } });
    expect(submit.workItem.documentNumber).toMatch(/^FEED-/);
    expect(body).not.toContain(NOTE);
  });
});

describe("scenario 35 through the feed: K1 moves the Submitted item internally", () => {
  let id = "";
  beforeAll(async () => {
    id = await atContractorReview(tower.c1Engineer, "Feed FD-35");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(tower.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await take(k1Engineer, id, "send_to_manager");
    await ok(tower.k1Manager.post(`/v1/work-items/${id}/claim`));
    await take(tower.k1Manager, id, "return_to_engineer");
  });

  it("shows C1 only its own events: no K1 internal move, no K1 name", async () => {
    const { entries, body } = await feed(tower.c1Pm);
    for (const e of ofItem(entries, id)) expect(e.by.companyName).toEqual(bilingual(C1_NAME));
    expect(ofItem(entries, id).map((e) => e.transition?.en)).not.toContain("Send to Manager");
    expect(body).not.toContain(K1_NAME);
    expect(body).not.toContain("Return to Engineer");
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

describe("scenario 47 through the feed: K1 fills its section and saves twice", () => {
  let id = "";
  beforeAll(async () => {
    id = await atContractorReview(tower.c1Engineer, "Feed FD-47");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(tower.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    const save = async (by: Caller, changes: Record<string, unknown>) =>
      ok(by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } }));
    await save(k1Engineer, { sample_checked: true });
    await save(k1Pm, { verification_note: VERIFICATION });
    // K1's own history holds both changes: the feed leaves them out for everyone.
    const history = (await ok(k1Engineer.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string }[];
    expect(history.filter((e) => e.type === "answers_changed")).toHaveLength(2);
  });

  it("gives no answers_changed to C1, OR or OW, nor to K1 itself", async () => {
    for (const by of [tower.c1Pm, orEngineer, owner, k1Engineer, k1Pm]) {
      const { entries, body } = await feed(by);
      expect(ofItem(entries, id).map((e) => e.type)).not.toContain("answers_changed");
      expect(entries.map((e) => e.type)).not.toContain("answers_changed");
      expect(body).not.toContain(VERIFICATION);
    }
  });
});

describe("another Contractor", () => {
  let own = "";
  beforeAll(async () => {
    own = await atContractorReview(c2Engineer, "Feed C2's own");
  });

  it("holds nothing of C1's in a C2 Member's feed", async () => {
    const { entries, body } = await feed(c2Engineer);
    expect(new Set(entries.map((e) => e.workItem.id))).toEqual(new Set([own]));
    expect(body).not.toContain(C1_NAME);
  });

  it("holds nothing of C2's in C1's, K1's or OR's feed while it is C2's Draft (V1)", async () => {
    for (const by of [tower.c1Pm, tower.k1Manager, orEngineer]) {
      expect(ofItem((await feed(by)).entries, own)).toEqual([]);
    }
  });

  it("answers a C1 item C2 reached by link with a 404, as one that doesn't exist", async () => {
    const c1Item = (await feed(tower.c1Pm)).entries[0]!.workItem.id;
    await expectHidden(c2Engineer.get(`/v1/work-items/${c1Item}`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${c1Item}/history`));
  });

  it("answers a Project the caller isn't on with a 404", async () => {
    await expectHidden(outsider.get(`/v1/projects/${tower.projectId}/activity`));
    await expectHidden(outsider.get(`/v1/projects/${randomUUID()}/activity`));
  });
});

describe("paging and filters", () => {
  let marId = "";
  let k1Acted = "";
  beforeAll(async () => {
    // A MAR, a second Type in the same Module.
    marId = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Feed MAR");
    // An item K1's engineer acts on, and one nobody at K1 touches.
    k1Acted = await atContractorReview(tower.c1Engineer, "Feed K1 acts");
    await ok(tower.c1Pm.post(`/v1/work-items/${k1Acted}/claim`));
    await take(tower.c1Pm, k1Acted, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${k1Acted}/claim`));
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
    expect(types).toEqual(expect.arrayContaining([{ code: "MAR", name: expect.objectContaining({ en: "Material Submittal" }), moduleKey: "submittals" }]));
    expect(types.map((t) => t.code)).toContain(TYPE);
    for (const t of types) expect(Object.keys(t).toSorted()).toEqual(["code", "moduleKey", "name"]);
  });

  it("filters by Module and by Type, and combines them", async () => {
    const everything = (await feed(tower.c1Pm)).entries;
    expect((await feed(tower.c1Pm, { module: "submittals" })).entries).toEqual(everything);
    expect((await feed(tower.c1Pm, { module: "inspections" })).entries).toEqual([]);
    const mars = (await feed(tower.c1Pm, { type: ["MAR"] })).entries;
    expect(new Set(mars.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    expect((await feed(tower.c1Pm, { type: ["MAR", TYPE] })).entries).toEqual(everything);
    expect((await feed(tower.c1Pm, { module: "inspections", type: ["MAR"] })).entries).toEqual([]);
  });

  it("keeps \"items I'm on\" to the ones I raised, held or acted on, combined with the other filters", async () => {
    // K1's engineer acted on (and held) the scenario items and k1Acted; the K1 PM only saved answers on one.
    const engineerOn = new Set((await feed(k1Engineer, { mine: true })).entries.map((e) => e.workItem.id));
    expect(engineerOn).toContain(k1Acted);
    expect(engineerOn).not.toContain(marId);
    expect((await feed(k1Engineer, { mine: true, type: ["MAR"] })).entries).toEqual([]);
    // The manager held and acted on the scenario 35 item only.
    const managerOn = new Set((await feed(tower.k1Manager, { mine: true })).entries.map((e) => e.workItem.id));
    expect(managerOn.size).toBe(1);
    // C1's engineer raised every C1 item: the MAR among them.
    expect(new Set((await feed(tower.c1Engineer, { mine: true, type: ["MAR"] })).entries.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    // Nobody at the Owner acted on anything.
    expect((await feed(owner, { mine: true })).entries).toEqual([]);
  });

  it("takes in the items I watch (RP-354), and lets them go when I stop watching", async () => {
    await ok(owner.request("PUT", `/v1/work-items/${marId}/watch`));
    const watched = (await feed(owner, { mine: true })).entries;
    expect(new Set(watched.map((e) => e.workItem.id))).toEqual(new Set([marId]));
    expect(watched).toEqual((await feed(owner, { type: ["MAR"] })).entries);
    await ok(owner.delete(`/v1/work-items/${marId}/watch`));
    expect((await feed(owner, { mine: true })).entries).toEqual([]);
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
