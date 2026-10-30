// Seam 1 of the RP-1062 scenarios (docs/visibility/scenarios/RP-1062.md): Chat on a Work Item, read and posted
// through the api. Every "hidden from" assert goes through expectHiddenFrom: a reader who may see the same message
// (or post on the same item, or read the same name) does so first, by id, so an empty read never passes for the
// wrong reason. Seam 2 of these scenarios is packages/db/test/chat-rls.test.ts; chat.test.ts tests the rest of Chat.
import { randomUUID } from "node:crypto";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { VisibilityGrant, WorkItemChat } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, inInternalReview, memberOnProject, ok, only, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

// The Tower's MARs attach a datasheet before they leave Draft, so the api needs its file store.
const api = await createTestApi({ files: true });
afterAll(() => api.close());

const C1_NAME = "Chat Scenario Contractor";
const K1_NAME = "Chat Scenario Consultant";
const OR_NAME = "Chat Scenario Owner Representative";
const C1_WRITER = "Rana Chatwriter";
const K1_WRITER = "Khalid Chatreviewer";
const OR_WRITER = "Omar Chatrepresentative";

let c1: Company;
let k1: Company;
let tower: Tower;
let c2Engineer: Caller;
let c2Pm: Caller;
let orEngineer: Caller;
let c1Writer: { id: string; caller: Caller };
let k1Writer: { id: string; caller: Caller };
let orWriter: { id: string; caller: Caller };

const chatUrl = (id: string) => `/v1/work-items/${id}/chat`;
const readChat = async (by: Caller, id: string): Promise<WorkItemChat> => (await ok(by.get(chatUrl(id)), 200)).json();
/** `by` posts on item `id`, which must be accepted; returns the new message's id. */
const posted = async (by: Caller, id: string, text: string): Promise<string> => (await ok(by.post(chatUrl(id), { body: `${text} ${randomUUID().slice(0, 8)}` }), 201)).json().id;

/** Item `id`'s messages as `by` reads them, for expectHiddenFrom: none for the plain 404 (readById fails on anything else). */
const thread = (id: string) => async (by: Caller) => (await readById<WorkItemChat>(chatUrl(id))(by)).flatMap((chat) => chat.messages);
/** Whether `by` may post on item `id`, for expectHiddenFrom: `[{ id }]` when the post is accepted, none for the plain 404. */
const poster = (id: string) => async (by: Caller) => {
  const res = await by.post(chatUrl(id), { body: `May I post? ${randomUUID().slice(0, 8)}` });
  if (res.statusCode === 201) return [{ id }];
  expect({ status: res.statusCode, body: res.body }, `post on ${id}`).toEqual({ status: 404, body: JSON.stringify({ error: "not_found" }) });
  return [];
};
/** An api answer as someone read it: the name a failure gives, and the body as it came. */
type Payload = { name: string; body: string };
const payload = async (name: string, read: ReturnType<Caller["get"]>): Promise<Payload> => ({ name, body: (await ok(read, 200)).body });
/** For expectHiddenFrom over payloads: `[{ id: text }]` when the payload holds `text`. */
const mentions = (text: string) => async (p: Payload) => (p.body.includes(text) ? [{ id: text }] : []);

const callers = new Map<Caller, string>();
const whoIs = (by: Caller) => callers.get(by) ?? "someone";

const onboard = async (name: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(name) }); // not hidden-from: the onboarding request's field
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};
/** Another Company on the Tower in `role`, seeing all of it. */
async function participant(company: Company, role: "contractor" | "owner_representative") {
  const id = await api.addParticipant(c1.caller, tower.projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
  return id;
}

beforeAll(async () => {
  c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  k1 = await onboard(K1_NAME);
  const c2 = await onboard("Chat Scenario Second Contractor");
  const or = await onboard(OR_NAME);
  tower = await buildTower(api, { c1, k1 }, "CVS");
  const c2ParticipantId = await participant(c2, "contractor");
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const orParticipantId = await participant(or, "owner_representative");
  orEngineer = await projectMember(api, or, orParticipantId, ["engineer"]);
  c1Writer = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: C1_WRITER });
  k1Writer = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { name: K1_WRITER });
  orWriter = await memberOnProject(api, or, orParticipantId, ["engineer"], { name: OR_WRITER });
  for (const [by, name] of [
    [tower.c1Engineer, "C1 engineer"],
    [tower.c1Pm, "C1 PM"],
    [tower.k1Manager, "K1 manager"],
    [c2Engineer, "C2 engineer"],
    [orEngineer, "OR engineer"],
  ] as const)
    callers.set(by, name);
});

describe("scenario RP-1062-1: C1 Submits a MAR to K1 and its Members post in its Chat; C2 Submits one of its own", () => {
  it("C2's engineer reads nothing of C1's Chat and gets the plain 404 for its thread and for posting there, as for a made-up id", async () => {
    const c1Item = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-1, C1");
    const c2Item = await submitted(tower, c2Engineer, c2Pm, "Chat RP-1062-1, C2");
    const message = await posted(tower.c1Engineer, c1Item, "Datasheet attached.");
    await posted(tower.c1Pm, c1Item, "Please review.");
    const name = whoIs;
    await expectHiddenFrom({ read: thread(c1Item), target: message, seenBy: [tower.c1Pm, tower.k1Manager], hiddenFrom: c2Engineer, name, label: "C1's thread" });
    const before = (await readChat(tower.c1Pm, c1Item)).count;
    await expectHiddenFrom({ read: poster(c1Item), target: c1Item, seenBy: tower.c1Engineer, hiddenFrom: c2Engineer, name, label: "posting on C1's item" });
    // C2's refused post wrote nothing; the C1 engineer's accepted one is the only new message.
    expect((await readChat(tower.c1Pm, c1Item)).count).toBe(before + 1);

    // The same plain 404 as a made-up or malformed id, from C2's engineer, who reads and posts on its own item.
    const asC2 = (read: (id: string) => (by: Caller) => Promise<unknown[]>) => async (id: string) => (await read(id)(c2Engineer)).map(() => ({ id: "answered" }));
    for (const other of [c1Item, randomUUID(), "not-an-id"]) {
      await expectHiddenFrom({ read: asC2((id) => readById(chatUrl(id))), target: "answered", seenBy: c2Item, hiddenFrom: other, label: "C2 reads a thread" });
      await expectHiddenFrom({ read: asC2(poster), target: "answered", seenBy: c2Item, hiddenFrom: other, label: "C2 posts" });
    }
  });

  it("C2 reads and posts in its own item's Chat, which C1 never reads", async () => {
    const c2Item = await submitted(tower, c2Engineer, c2Pm, "Chat RP-1062-1, C2's own");
    const own = await posted(c2Engineer, c2Item, "Second contractor here.");
    await expectHiddenFrom({ read: thread(c2Item), target: own, seenBy: [c2Engineer, tower.k1Manager], hiddenFrom: [tower.c1Engineer, tower.c1Pm], name: whoIs, label: "C2's thread" });
  });
});

describe("scenario RP-1062-2: K1's manager covers Mechanical only; C1's Submitted items in and out of it have Chat", () => {
  it("they read nothing of the Electrical item's Chat and get the plain 404 posting there; they read and post in the Mechanical one", async () => {
    const mechanical = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { trade: only(tower.mechanical) });
    callers.set(mechanical.caller, "K1 Mechanical manager");
    const electricalItem = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-2, Electrical");
    const mechanicalItem = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-2, Mechanical", tower.mechanical);
    const outside = await posted(tower.c1Engineer, electricalItem, "Cable trays datasheet.");
    await expectHiddenFrom({ read: thread(electricalItem), target: outside, seenBy: tower.k1Manager, hiddenFrom: mechanical.caller, name: whoIs, label: "outside their Trade" });
    await expectHiddenFrom({ read: poster(electricalItem), target: electricalItem, seenBy: tower.k1Manager, hiddenFrom: mechanical.caller, name: whoIs, label: "posting outside their Trade" });
    // The one they cover: they post, and they read their message, which C2 doesn't.
    const theirs = await posted(mechanical.caller, mechanicalItem, "Seen.");
    await expectHiddenFrom({ read: thread(mechanicalItem), target: theirs, seenBy: [mechanical.caller, tower.c1Pm], hiddenFrom: c2Engineer, name: whoIs, label: "the Mechanical item" });
  });
});

describe("scenario RP-1062-3: C1's engineer posts on an item still in C1's internal review", () => {
  it("is refused, not_submitted (409), and nothing is written; the same engineer posts once the item is Submitted", async () => {
    const id = await inInternalReview(tower, tower.c1Engineer, "Chat RP-1062-3");
    const res = await tower.c1Engineer.post(chatUrl(id), { body: "Note to self." });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_submitted" } });
    expect(await readChat(tower.c1Engineer, id)).toEqual({ messages: [], count: 0 });
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit");
    const message = await posted(tower.c1Engineer, id, "Now Submitted.");
    expect((await readChat(tower.c1Engineer, id)).messages.map((m) => m.id)).toEqual([message]);
  });
});

describe("scenario RP-1062-4: C1's engineer, K1's manager and the Owner's Representative post on C1's Submitted item", () => {
  const contractor = { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } };
  const consultant = { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } };
  const ownerRep = { baseRole: "owner_representative", name: { en: "Owner Representative", ar: "ممثل المالك" } };
  let id = "";
  const ids = { c1: "", k1: "", or: "" };
  beforeAll(async () => {
    id = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-4");
    ids.c1 = await posted(c1Writer.caller, id, "Datasheet attached.");
    ids.k1 = await posted(k1Writer.caller, id, "Reviewing.");
    ids.or = await posted(orWriter.caller, id, "Noted.");
  });

  it("C1's PM reads C1's author by name and the others' as Company name and Project Role only, oldest first, with the count", async () => {
    const chat = await readChat(tower.c1Pm, id);
    expect(chat.count).toBe(3);
    expect(chat.messages.map((m) => [m.id, m.author])).toEqual([
      [ids.c1, { kind: "own", memberName: bilingual(C1_WRITER), companyName: bilingual(C1_NAME), projectRole: contractor }],
      [ids.k1, { kind: "other", companyName: bilingual(K1_NAME), projectRole: consultant }],
      [ids.or, { kind: "other", companyName: bilingual(OR_NAME), projectRole: ownerRep }],
    ]);
  });

  it("K1's manager reads K1's author by name and the others' as Company name and Project Role only, oldest first, with the count", async () => {
    const chat = await readChat(tower.k1Manager, id);
    expect(chat.count).toBe(3);
    expect(chat.messages.map((m) => [m.id, m.author])).toEqual([
      [ids.c1, { kind: "other", companyName: bilingual(C1_NAME), projectRole: contractor }],
      [ids.k1, { kind: "own", memberName: bilingual(K1_WRITER), companyName: bilingual(K1_NAME), projectRole: consultant }],
      [ids.or, { kind: "other", companyName: bilingual(OR_NAME), projectRole: ownerRep }],
    ]);
    const at = chat.messages.map((m) => Date.parse(m.at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("no Member's name or id reaches another Company's api payload (V14), though their own Company reads the name", async () => {
    const chat = (who: string, by: Caller) => payload(who, by.get(chatUrl(id)));
    const [c1Pm, k1Manager, or] = [await chat("C1 PM", tower.c1Pm), await chat("K1 manager", tower.k1Manager), await chat("OR engineer", orEngineer)];
    const name = (p: Payload) => p.name;
    await expectHiddenFrom({ read: mentions(C1_WRITER), target: C1_WRITER, seenBy: c1Pm, hiddenFrom: [k1Manager, or], name, label: "C1's author's name" });
    await expectHiddenFrom({ read: mentions(K1_WRITER), target: K1_WRITER, seenBy: k1Manager, hiddenFrom: [c1Pm, or], name, label: "K1's author's name" });
    await expectHiddenFrom({ read: mentions(OR_WRITER), target: OR_WRITER, seenBy: or, hiddenFrom: [c1Pm, k1Manager], name, label: "OR's author's name" });
    // A Member's id is in their own Company's Member list, and in no Chat payload.
    const members = async (company: Company, who: string) => payload(who, company.caller.get("/v1/members"));
    for (const [writer, company, others] of [
      [c1Writer, c1, [k1Manager, or]],
      [k1Writer, k1, [c1Pm, or]],
    ] as const) {
      await expectHiddenFrom({ read: mentions(writer.id), target: writer.id, seenBy: await members(company, "its Company's Member list"), hiddenFrom: [...others], name, label: "an author's id" });
    }
  });
});

describe("scenario RP-1062-5: K1's Mechanical manager reads an item's Chat; their Visibility is then narrowed off the item", () => {
  it("the thread is gone at once, and posting is the plain 404; they go on reading the Chat of the items they still cover", async () => {
    const mechanical = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { trade: only(tower.mechanical) });
    callers.set(mechanical.caller, "K1 Mechanical manager");
    const visibility = (trade: VisibilityGrant) =>
      ok(k1.caller.request("PUT", `/v1/participants/${tower.k1ParticipantId}/members/${mechanical.id}/visibility`, { trade, location: all }));
    const mechanicalItem = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-5, Mechanical", tower.mechanical);
    const electricalItem = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Chat RP-1062-5, Electrical");
    const pipes = await posted(tower.c1Engineer, mechanicalItem, "Pipes datasheet.");
    const trays = await posted(tower.c1Engineer, electricalItem, "Trays datasheet.");
    // Now: they read the Mechanical item's Chat, which C2 doesn't.
    await expectHiddenFrom({ read: thread(mechanicalItem), target: pipes, seenBy: mechanical.caller, hiddenFrom: c2Engineer, name: whoIs, label: "before" });

    await visibility(only(tower.electrical));
    await expectHiddenFrom({ read: thread(mechanicalItem), target: pipes, seenBy: tower.k1Manager, hiddenFrom: mechanical.caller, name: whoIs, label: "narrowed off" });
    await expectHiddenFrom({ read: poster(mechanicalItem), target: mechanicalItem, seenBy: tower.k1Manager, hiddenFrom: mechanical.caller, name: whoIs, label: "posting, narrowed off" });
    // The item they still cover.
    expect((await thread(electricalItem)(mechanical.caller)).map((m) => m.id)).toContain(trays);
  });
});
