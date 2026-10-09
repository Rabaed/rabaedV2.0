// Seam 1 for notifications per Transition (RP-432, WF-9; spec RP-423; visibility.md
// the Notifications row). A Transition of a Workflow names extra recipients: the
// raiser, watchers, a Position of the acting Participant (never a person). They
// hear of the move in the bell always (email by their own settings), and each is
// checked again, as that Member, when it is delivered: one who no longer sees the
// item, or who belongs to another Company, hears nothing.
//
// The test Workflow's `submit` (C1's Project Manager Submits to K1) notifies the
// raiser, the watchers and C1's engineers.
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { type Notification, type NotificationList, type NotificationSettings, type NotificationSettingsView } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "TRNOT";
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
let at: Tower;
let k1ParticipantId = "";
let c1Engineer2: Caller; // Another C1 engineer: named by Position only.
let c1Engineer2Id = "";
let k1Engineer: Caller; // An engineer of K1: "engineer" of another Participant is not named.
let c2Engineer: Caller; // Another Contractor: never sees C1's items.
let c1Narrowed: Caller; // A C1 engineer narrowed off Electrical: never sees these items.

const settingsOf = async (by: Caller): Promise<NotificationSettingsView> => (await ok(by.get("/v1/notification-settings"), 200)).json();
async function saveSettings(by: Caller, settings: Partial<NotificationSettings>) {
  const now = await settingsOf(by);
  await ok(
    by.request("PUT", "/v1/notification-settings", {
      settings: { ...now.settings, ...settings },
      emailPaused: now.emailPaused,
      preferredLanguage: now.preferredLanguage,
    }),
  );
}

/** The bell's notifications `by` has about item `id`. */
const about = async (by: Caller, id: string): Promise<Notification[]> =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);
const movesOf = async (by: Caller, id: string) => (await about(by, id)).filter((n) => n.kind === "watched_event" && n.event?.transition?.en === "Submit");

/** How delivery routed each Member's notifications about item `id` (the bell and email). */
const routed = async (id: string) =>
  (
    await sql<{ member_id: string; kind: string; in_app: boolean; email: string }>`
      select member_id, kind, in_app, email from notification where work_item_id = ${id} and kind = 'watched_event' order by member_id
    `.execute(migrator)
  ).rows;

/** A raised item, sent to C1's review and claimed by its Project Manager, who is about to Submit it. */
async function inReview(title: string): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: TYPE,
      title,
      answers: { model: "P1", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
  return id;
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Transition notices", ar: "إشعارات الانتقال" }, schema, {
    notifications: { submit: [{ to: "holder" }, { to: "raiser" }, { to: "watchers" }, { to: "position", position: "engineer" }] },
  });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TRN");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  const second = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"]);
  c1Engineer2 = second.caller;
  c1Engineer2Id = second.id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c1Narrowed = await projectMember(api, c1, at.c1ParticipantId, ["engineer"], { trade: only(at.mechanical) });
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker);
});

describe("a Transition that notifies a Position", () => {
  it("tells that Position's Members of the acting Participant who see the item, in the bell; nobody of another Company, Position or Visibility", async () => {
    const id = await inReview("Pumps");
    await drainOutbox(worker);
    // A Transition that names nobody tells the Position's Members nothing.
    expect(await about(c1Engineer2, id)).toEqual([]);

    await take(at.c1Pm, id, "submit");
    await drainOutbox(worker);

    const [n, ...more] = await movesOf(c1Engineer2, id);
    expect(more).toEqual([]);
    expect(n).toMatchObject({ kind: "watched_event", title: "Pumps", readAt: null });
    // The actor, K1's engineer (another Participant's "engineer"), another Contractor and a narrowed C1 engineer hear nothing of it.
    for (const who of [at.c1Pm, k1Engineer, c2Engineer, c1Narrowed]) expect(await movesOf(who, id)).toEqual([]);
  });

  it("checks each recipient again at delivery: one narrowed off the item after the move hears nothing", async () => {
    const id = await inReview("Valves");
    await take(at.c1Pm, id, "submit");
    // After the move, before it is delivered, a Position Member is narrowed off Electrical.
    await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${c1Engineer2Id}/visibility`, { trade: only(at.mechanical), location: all }));
    try {
      await drainOutbox(worker);
      expect(await movesOf(c1Engineer2, id)).toEqual([]);
      expect((await routed(id)).filter((r) => r.member_id === c1Engineer2Id)).toEqual([]);
    } finally {
      await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${c1Engineer2Id}/visibility`, { trade: all, location: all }));
    }
  });
});

describe("a Transition that notifies the raiser", () => {
  it("tells a raiser who stopped watching, who still sees the item", async () => {
    const id = await inReview("Fans");
    await ok(at.c1Engineer.delete(`/v1/work-items/${id}/watch`));
    await take(at.c1Pm, id, "submit");
    await drainOutbox(worker);
    expect(await movesOf(at.c1Engineer, id)).toHaveLength(1);
  });
});

describe("in-app is always sent", () => {
  it("reaches a Member who turned their email off, with no email routed", async () => {
    await saveSettings(c1Engineer2, { watched: { email: "off", outcomes: ["A", "B", "C", "D", "cancelled"] } });
    const id = await inReview("Chillers");
    await take(at.c1Pm, id, "submit");
    await drainOutbox(worker);
    expect(await movesOf(c1Engineer2, id)).toHaveLength(1);
    expect((await routed(id)).filter((r) => r.member_id === c1Engineer2Id)).toEqual([{ member_id: c1Engineer2Id, kind: "watched_event", in_app: true, email: "none" }]);
  });

  it("is still silenced by a Member's mute of the Project, which is their own setting a Workflow never overrides", async () => {
    await ok(c1Engineer2.request("PUT", `/v1/projects/${at.projectId}/mute`));
    try {
      const id = await inReview("Boilers");
      await take(at.c1Pm, id, "submit");
      await drainOutbox(worker);
      expect(await movesOf(c1Engineer2, id)).toEqual([]);
    } finally {
      await ok(c1Engineer2.delete(`/v1/projects/${at.projectId}/mute`));
    }
  });
});
