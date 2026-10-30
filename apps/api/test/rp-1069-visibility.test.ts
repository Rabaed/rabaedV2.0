// Seam 1 for what the Submittal Panel's Chat tab (RP-1069) draws from: the item's Chat read,
// `GET /v1/work-items/:id/chat` (RP-1062; visibility.md V6, V14 and the Chat row; scenario RP-1069-1).
// K1's engineer reads C1's Submitted item's thread: C1's author and the Owner's as their Company's
// name and Project Role only, never the person; K1's colleague and the reader by name (the positive
// control). Before the Submission Date K1 doesn't read the item's thread at all, and C1 reads it
// empty and can't post. Seam 2: packages/db/test/rp-1069-visibility-rls.test.ts.
import { randomUUID } from "node:crypto";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { WorkItemChat } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, inInternalReview, ok, projectMember, submitted, type Company, type Tower } from "./support/tower.ts";

// The Tower's MARs attach a datasheet before they leave Draft, so the api needs its file store.
const api = await createTestApi({ files: true });
afterAll(() => api.close());

const C1_NAME = "Chat Tab Contracting";
const K1_NAME = "Design Consultants LLC";
const OW_NAME = "Chat Tab Owner Holding";
const contractor = { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } };
const consultant = { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } };
const owner = { baseRole: "owner", name: { en: "Owner", ar: "المالك" } };

let at: Tower;
let k1Engineer: Caller; // The reader.
let owRep: Caller;
let id = "";
let internal = "";
const message = { c1: "", k1Colleague: "", reader: "", owner: "" };
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

const chatUrl = (item: string) => `/v1/work-items/${item}/chat`;
const readChat = async (by: Caller, item: string): Promise<WorkItemChat> => (await ok(by.get(chatUrl(item)), 200)).json();
/** `by` posts on item `item` and it is accepted; returns the new message's id. */
const post = async (by: Caller, item: string, body: unknown): Promise<string> => (await ok(by.post(chatUrl(item), body), 201)).json().id;

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

beforeAll(async () => {
  const c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  const k1 = await onboard(K1_NAME);
  const ow = await onboard(OW_NAME);
  at = await buildTower(api, { c1, k1 }, "RCT");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"], { name: "Ahmed Reader" });
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  owRep = await projectMember(api, ow, owParticipant, ["representative"], { name: "Faisal Owner" });
  for (const [by, name] of [[at.c1Engineer, "C1 engineer"], [at.c1Pm, "C1 PM"], [k1Engineer, "K1 engineer"], [at.k1Manager, "K1 manager"], [owRep, "OW representative"]] as const) names.set(by, name);

  id = await submitted(at, at.c1Engineer, at.c1Pm, "Chat tab cable trays");
  internal = await inInternalReview(at, at.c1Engineer, "Chat tab, not yet Submitted");
  message.c1 = await post(at.c1Engineer, id, { body: "Datasheet attached." });
  message.k1Colleague = await post(at.k1Manager, id, { body: "Reviewing today." });
  message.reader = await post(k1Engineer, id, { body: "Checking the sample." });
  message.owner = await post(owRep, id, { body: "Please prioritise." });
});

describe("scenario RP-1069-1: K1's engineer opens the Chat tab of C1's Submitted item", () => {
  it("reads C1's and the Owner's messages by Company name and Project Role only; K1's colleague and the reader by name", async () => {
    const chat = await readChat(k1Engineer, id);
    expect(chat.messages.map((m) => [m.id, m.author, m.mine, m.body])).toEqual([
      [message.c1, { kind: "other", companyName: bilingual(C1_NAME), projectRole: contractor }, false, "Datasheet attached."],
      [message.k1Colleague, { kind: "own", memberName: expect.any(Object), companyName: bilingual(K1_NAME), projectRole: consultant }, false, "Reviewing today."],
      [message.reader, { kind: "own", memberName: bilingual("Ahmed Reader"), companyName: bilingual(K1_NAME), projectRole: consultant }, true, "Checking the sample."],
      [message.owner, { kind: "other", companyName: bilingual(OW_NAME), projectRole: owner }, false, "Please prioritise."],
    ]);
  });

  it("names C1's author to C1 only, and the Owner's to the Owner only", async () => {
    /** The messages `by` reads named: their own Company's. */
    const namedMessages = (by: Caller) => readChat(by, id).then((chat) => chat.messages.filter((m) => m.author.kind === "own"));
    await expectHiddenFrom({ read: namedMessages, target: message.c1, seenBy: at.c1Pm, hiddenFrom: [k1Engineer, owRep], name: named, label: "C1's author" });
    await expectHiddenFrom({ read: namedMessages, target: message.owner, seenBy: owRep, hiddenFrom: [k1Engineer, at.c1Pm], name: named, label: "the Owner's author" });
  });

  it("takes no author's name from a post: a name sent with it is dropped, and K1 reads C1 by its name only", async () => {
    const signed = await post(at.c1Engineer, id, { body: "Signed, Hafiz", memberName: bilingual("Hafiz Hamdan"), author: { memberName: bilingual("Hafiz Hamdan") } });
    const read = (await readChat(k1Engineer, id)).messages.find((m) => m.id === signed);
    expect(read).toEqual({ id: signed, author: { kind: "other", companyName: bilingual(C1_NAME), projectRole: contractor }, mine: false, body: "Signed, Hafiz", at: expect.any(String) });
  });
});

describe("scenario RP-1069-1: before the Submission Date", () => {
  it("K1 doesn't read the thread of an item still in C1's review, while C1 reads it", async () => {
    const thread = (by: Caller) => readById<WorkItemChat>(chatUrl(internal))(by).then((read) => read.map(() => ({ id: internal })));
    await expectHiddenFrom({ read: thread, target: internal, seenBy: at.c1Engineer, hiddenFrom: [k1Engineer, at.k1Manager, owRep], name: named, label: "the thread" });
  });

  it("C1 reads the thread empty, and its post is refused not_submitted (the composer is off)", async () => {
    expect(await readChat(at.c1Engineer, internal)).toEqual({ messages: [], count: 0 }); // not hidden-from: C1 sees the item; its thread has no message yet
    const res = await at.c1Engineer.post(chatUrl(internal), { body: `Too early ${randomUUID().slice(0, 8)}` });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_submitted" } });
  });
});
