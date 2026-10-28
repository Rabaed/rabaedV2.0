// Seam 1: Chat on a Work Item (RP-1062, spec RP-1054 decision C1; visibility.md V6 and the Chat row). Every Member
// who sees the item reads its Chat, oldest first with a count, and posts from the Submission Date on. Another
// Company's author reaches the payload as that Company's name and Project Role only; a Member who can't see the
// item gets the plain 404 for the thread and for posting. The database scenarios are seam 2's chat-rls.test.ts.
import { randomUUID } from "node:crypto";
import type { VisibilityGrant, WorkItemChat } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, inInternalReview, memberOnProject, ok, only, projectMember, submitted, type Company, type Tower } from "./support/tower.ts";

// The Tower's MARs attach a datasheet before they leave Draft, so the api needs its file store.
const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let k1: Company;
let tower: Tower;
let c1Writer: { id: string; caller: Caller };
let c2Engineer: Caller;
let k1Mechanical: Caller; // A K1 manager covering Mechanical only.
let k1MechanicalId = "";
let k1ParticipantId = "";
const names = { c1: bilingual(""), k1: bilingual("") };
const item = { c1Submitted: "", c1Mechanical: "", c1Internal: "", c2Submitted: "" };

/** One character that is two UTF-16 code units (a grinning face). */
const EMOJI = "\u{1F600}";
const chatUrl = (id: string) => `/v1/work-items/${id}/chat`;
const readChat = async (by: Caller, id: string): Promise<WorkItemChat> => (await ok(by.get(chatUrl(id)), 200)).json();
const postChat = (by: Caller, id: string, body: unknown) => by.post(chatUrl(id), { body });
/** `by` posts a body no other test posts on item `id`, which must be accepted; returns the body. */
async function posted(by: Caller, id: string, text: string): Promise<string> {
  const body = `${text} ${randomUUID().slice(0, 8)}`;
  await ok(postChat(by, id, body), 201);
  return body;
}
const bodies = async (by: Caller, id: string) => (await readChat(by, id)).messages.map((m) => m.body);
const contractor = { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } };
const consultant = { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } };

beforeAll(async () => {
  c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  k1 = await onboard("Design Consultants LLC");
  const c2 = await onboard("Second Contractor Co");
  tower = await buildTower(api, { c1, k1 }, "CHT");
  k1ParticipantId = tower.k1ParticipantId!;

  const companies: { company: { legalName: { en: string; ar: string } }; projectRole: { baseRole: string } }[] = (
    await ok(c1.caller.get(`/v1/projects/${tower.projectId}/participants`), 200)
  ).json().participants;
  names.c1 = companies.find((p) => p.projectRole.baseRole === "contractor")!.company.legalName;
  names.k1 = companies.find((p) => p.projectRole.baseRole === "consultant")!.company.legalName;

  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  const c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const mechanical = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { trade: only(tower.mechanical) });
  k1Mechanical = mechanical.caller;
  k1MechanicalId = mechanical.id;
  const writer = await api.inviteMember(c1.caller, { fullName: bilingual("Sara Writer") });
  c1Writer = { id: writer.id, caller: await api.acceptInvitation(writer.invitationToken) };
  await api.addProjectMember(c1.caller, tower.c1ParticipantId, writer.id);
  await ok(c1.caller.request("PUT", `/v1/participants/${tower.c1ParticipantId}/members/${writer.id}/visibility`, { trade: all, location: all }));

  const { c1Engineer, c1Pm } = tower;
  item.c1Submitted = await submitted(tower, c1Engineer, c1Pm, "Cable trays");
  item.c1Mechanical = await submitted(tower, c1Engineer, c1Pm, "Chilled water pipes", tower.mechanical);
  item.c1Internal = await inInternalReview(tower, c1Engineer, "Cable ladders");
  item.c2Submitted = await submitted(tower, c2Engineer, c2Pm, "Cable trays, second contractor");
});

describe("GET and POST /v1/work-items/:id/chat", () => {
  it("posts trimmed text and reads it oldest first, with the count; own authors by name, another Company by name and Project Role only", async () => {
    // An item of this test's own, so its thread holds only what the test posts.
    const fresh = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Cable trays, chat");
    expect(await readChat(tower.k1Manager, fresh)).toEqual({ messages: [], count: 0 });
    const first = await ok(postChat(c1Writer.caller, fresh, "  Datasheet attached.  "), 201);
    expect(first.json()).toEqual({ id: expect.any(String) });
    await ok(postChat(tower.k1Manager, fresh, "Thanks, reviewing."), 201);

    const asC1 = await readChat(tower.c1Pm, fresh);
    expect(asC1.count).toBe(2);
    expect(asC1.messages).toEqual([
      {
        id: first.json().id,
        author: { kind: "own", memberName: bilingual("Sara Writer"), companyName: names.c1, projectRole: contractor },
        mine: false,
        body: "Datasheet attached.",
        at: expect.any(String),
      },
      {
        id: expect.any(String),
        author: { kind: "other", companyName: names.k1, projectRole: consultant },
        mine: false,
        body: "Thanks, reviewing.",
        at: expect.any(String),
      },
    ]);
    expect(Date.parse(asC1.messages[0]!.at)).toBeLessThanOrEqual(Date.parse(asC1.messages[1]!.at));
    expect((await readChat(c1Writer.caller, fresh)).messages[0]!.mine).toBe(true);

    // K1 reads C1's author as C1 and Contractor: neither the Member's name nor id is anywhere in the payload.
    const res = await ok(tower.k1Manager.get(chatUrl(fresh)), 200);
    expect(res.json().messages[0].author).toEqual({ kind: "other", companyName: names.c1, projectRole: contractor });
    expect(res.body).not.toContain("Sara Writer");
    expect(res.body).not.toContain(c1Writer.id);
  });

  it("is 404 for a competing Contractor (V3), a made-up id and a malformed one; the same Member reads and posts on its own item", async () => {
    await posted(tower.c1Engineer, item.c1Submitted, "Datasheet attached.");
    await expectHidden(c2Engineer.get(chatUrl(item.c1Submitted)), "read, C2");
    await expectHidden(postChat(c2Engineer, item.c1Submitted, "Hello?"), "post, C2");
    await expectHidden(c2Engineer.get(chatUrl(randomUUID())), "read, made-up id");
    await expectHidden(postChat(c2Engineer, randomUUID(), "Hello?"), "post, made-up id");
    await expectHidden(c2Engineer.get(chatUrl("not-an-id")), "read, malformed id");
    await expectHidden(postChat(c2Engineer, "not-an-id", "Hello?"), "post, malformed id");
    // Positive control.
    const own = await posted(c2Engineer, item.c2Submitted, "Second contractor here.");
    expect(await bodies(c2Engineer, item.c2Submitted)).toContain(own);
    expect(await bodies(tower.c1Pm, item.c1Submitted)).not.toContain("Hello?");
  });

  it("is 404 for a Member outside the item's Trade (layer 4); the same Member reads and posts on one of their Trade", async () => {
    await posted(tower.c1Engineer, item.c1Submitted, "Cable trays datasheet.");
    await expectHidden(k1Mechanical.get(chatUrl(item.c1Submitted)), "read");
    await expectHidden(postChat(k1Mechanical, item.c1Submitted, "Seen."), "post");
    const seen = await posted(k1Mechanical, item.c1Mechanical, "Seen.");
    expect(await bodies(k1Mechanical, item.c1Mechanical)).toContain(seen);
  });

  it("refuses a post before the Submission Date with 409 not_submitted; the thread reads empty", async () => {
    const res = await postChat(tower.c1Engineer, item.c1Internal, "Note to self.");
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_submitted" } });
    expect(await readChat(tower.c1Engineer, item.c1Internal)).toEqual({ messages: [], count: 0 });
  });

  it("refuses with 422 invalid_body a body empty or blank once trimmed, or over 4000 characters; 400 for one that isn't text; and writes nothing", async () => {
    const before = (await readChat(tower.c1Pm, item.c1Submitted)).count;
    for (const body of ["", "   ", "\n\t \r\n", "x".repeat(4001), EMOJI.repeat(4001)]) {
      const res = await postChat(tower.c1Pm, item.c1Submitted, body);
      expect({ status: res.statusCode, body: res.json() }, JSON.stringify(body.slice(0, 8))).toEqual({ status: 422, body: { error: "invalid_body" } });
    }
    for (const body of [42, null]) expect((await postChat(tower.c1Pm, item.c1Submitted, body)).statusCode, JSON.stringify(body)).toBe(400);
    expect((await readChat(tower.c1Pm, item.c1Submitted)).count).toBe(before);
    // 4000 characters, counted as characters: an emoji is one (two UTF-16 code units).
    await ok(postChat(tower.c1Pm, item.c1Submitted, EMOJI.repeat(4000)), 201);
    await ok(postChat(tower.c1Pm, item.c1Submitted, "x".repeat(4000)), 201);
  });

  it("is 404 at once for a Member who loses access, who goes on reading where they still have it", async () => {
    const visibility = (trade: VisibilityGrant) =>
      ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${k1MechanicalId}/visibility`, { trade, location: all }));
    const mechanical = await posted(tower.c1Engineer, item.c1Mechanical, "Pipes datasheet.");
    const electrical = await posted(tower.c1Engineer, item.c1Submitted, "Trays datasheet.");
    // The Mechanical manager reads the Mechanical item now; narrowed to Electrical, they read it no more.
    expect(await bodies(k1Mechanical, item.c1Mechanical)).toContain(mechanical);
    await visibility(only(tower.electrical));
    try {
      await expectHidden(k1Mechanical.get(chatUrl(item.c1Mechanical)), "read after");
      await expectHidden(postChat(k1Mechanical, item.c1Mechanical, "Still here?"), "post after");
      expect(await bodies(k1Mechanical, item.c1Submitted)).toContain(electrical);
    } finally {
      await visibility(only(tower.mechanical));
    }
  });
});
