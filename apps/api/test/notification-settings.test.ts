// Seam 1 for notification settings, the routing rule and in-app notifications
// of watched items (RP-355, spec RP-344 "Notifications"; visibility.md the
// Notifications row and scenarios 68 and 70). A Member sets, per group, the bell
// and the email, the outcomes of watched items that notify, "Pause all email",
// the language of their emails and a mute per Project; delivery routes every
// notification through them. Watchers hear of a watched item's Transitions,
// Codes, new Revisions and closing, if they still see it and may read the event;
// never its actor. A claim withdraws the pool colleagues' unread "Step reached".
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import {
  defaultNotificationSettings,
  type Notification,
  type NotificationList,
  type NotificationSettings,
  type NotificationSettingsView,
  type WorkItemHistory,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, DEFAULT_PASSWORD, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

let c1: Company;
let k1: Company;
let or: Company;
let at: Tower;
let k1ParticipantId = "";
let orParticipantId = "";
let k1Manager2: Caller; // A second K1 Manager: the Consultant review pool has two.
let c2Engineer: Caller; // Another Contractor: never sees C1's items.

const meOf = async (by: Caller): Promise<string> => (await ok(by.get("/v1/me"), 200)).json().member.id;
const settingsOf = async (by: Caller): Promise<NotificationSettingsView> => (await ok(by.get("/v1/notification-settings"), 200)).json();
const putSettings = (by: Caller, body: unknown) => by.request("PUT", "/v1/notification-settings", body);
async function saveSettings(by: Caller, change: { settings?: Partial<NotificationSettings>; emailPaused?: boolean; preferredLanguage?: "en" | "ar" }) {
  const now = await settingsOf(by);
  await ok(
    putSettings(by, {
      settings: { ...now.settings, ...change.settings },
      emailPaused: change.emailPaused ?? now.emailPaused,
      preferredLanguage: change.preferredLanguage ?? now.preferredLanguage,
    }),
  );
}
const mute = (by: Caller, projectId: string) => by.request("PUT", `/v1/projects/${projectId}/mute`);
const unmute = (by: Caller, projectId: string) => by.delete(`/v1/projects/${projectId}/mute`);
const watch = (by: Caller, id: string) => ok(by.request("PUT", `/v1/work-items/${id}/watch`));

/** The bell's notifications `by` has about item `id`. */
const about = async (by: Caller, id: string): Promise<Notification[]> =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);
const kinds = async (by: Caller, id: string) => (await about(by, id)).map((n) => n.kind).sort();
const watched = async (by: Caller, id: string) => (await about(by, id)).filter((n) => n.kind === "watched_event");

/** K1's manager claims the Submitted MAR and issues `code`. */
async function issue(id: string, code: "approve_a" | "revise_c", by: Caller = at.k1Manager) {
  const verification = code === "approve_a" ? { matches_specification: true } : { matches_specification: false, verification_note: "Too dim" };
  const answers = { ...(await detail(by, id)).answers, sample_checked: true, ...verification };
  await ok(by.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
  await ok(by.post(`/v1/work-items/${id}/claim`));
  await ok(by.post(`/v1/work-items/${id}/transitions`, { transition: code, answers: { remarks: "Noted" }, idempotencyKey: randomUUID() }));
}

/** A MAR C1's engineer sends to C1's internal review. */
async function inReview(title: string): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "MAR",
      title,
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(at.c1Engineer, id);
  await take(at.c1Engineer, id, "send_for_review");
  return id;
}

/**
 * How each Member's notification of item `id` was routed, as delivery stored it
 * for the email and digest jobs (RP-357, RP-358): no api reads it yet.
 */
const routed = async (id: string) =>
  (
    await sql<{ member_id: string; kind: string; in_app: boolean; email: string }>`
      select member_id, kind, in_app, email from notification where work_item_id = ${id} order by member_id, kind
    `.execute(migrator)
  ).rows;

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "NTF");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  k1Manager2 = await projectMember(api, k1, k1ParticipantId, ["manager"]);
  orParticipantId = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipantId}/visibility`, { trade: all, location: all }));
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker);
});

describe("notification settings", () => {
  it("start from the defaults, with the Member's Projects unmuted", async () => {
    const mine = await settingsOf(at.c1Engineer);
    expect(mine).toMatchObject({ settings: defaultNotificationSettings, emailPaused: false, preferredLanguage: "en", receivesWeeklyReport: false });
    expect(mine.projects).toEqual([{ id: at.projectId, code: "NTF", name: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" }, muted: false }]);
  });

  it("are saved for the Member who sets them, and nobody else", async () => {
    const member = await projectMember(api, c1, at.c1ParticipantId, ["engineer"]);
    const settings: NotificationSettings = {
      ...defaultNotificationSettings,
      vacancy: { inApp: false, email: "off" },
      watched: { inApp: true, email: "immediate", outcomes: ["A"] },
    };
    await saveSettings(member, { settings, emailPaused: true, preferredLanguage: "ar" });
    expect(await settingsOf(member)).toMatchObject({ settings, emailPaused: true, preferredLanguage: "ar" });
    expect((await settingsOf(at.c1Engineer)).settings).toEqual(defaultNotificationSettings);
  });

  it("refuse settings that aren't whole", async () => {
    const { settings } = await settingsOf(at.c1Engineer);
    const { outcomes: _, ...noTicks } = settings.watched;
    await ok(putSettings(at.c1Engineer, { settings: { ...settings, watched: noTicks }, emailPaused: false, preferredLanguage: "en" }), 400);
    await ok(putSettings(at.c1Engineer, { settings: { ...settings, sent_back: { inApp: true, email: "weekly" } }, emailPaused: false, preferredLanguage: "en" }), 400);
    expect((await settingsOf(at.c1Engineer)).settings).toEqual(defaultNotificationSettings);
  });

  it("take the language of emails from the browser at the first sign-in that tells it, and only then", async () => {
    const { email } = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"]);
    const first = await api.signIn(email, DEFAULT_PASSWORD, "ar");
    expect((await settingsOf(first)).preferredLanguage).toBe("ar");
    const later = await api.signIn(email, DEFAULT_PASSWORD, "en");
    expect((await settingsOf(later)).preferredLanguage).toBe("ar");
  });

  it("don't show the Weekly Step Age report row to a Member who doesn't hold Assign", async () => {
    // No Rabaed Default Position holds Assign yet.
    expect((await settingsOf(at.k1Manager)).receivesWeeklyReport).toBe(false);
  });
});

describe("a Project mute", () => {
  it("is set and cleared by the Member, for a Project they are on", async () => {
    const member = await projectMember(api, c1, at.c1ParticipantId, ["engineer"]);
    await ok(mute(member, at.projectId));
    expect((await settingsOf(member)).projects).toEqual([expect.objectContaining({ id: at.projectId, muted: true })]);
    expect((await settingsOf(at.c1Engineer)).projects).toEqual([expect.objectContaining({ id: at.projectId, muted: false })]);
    await ok(unmute(member, at.projectId));
    expect((await settingsOf(member)).projects).toEqual([expect.objectContaining({ id: at.projectId, muted: false })]);
  });

  it("is refused for a Project the Member is not on, like a made-up one", async () => {
    const elsewhere = (await api.createProject(c1.caller, { code: "ELS" })).id;
    for (const projectId of [elsewhere, randomUUID(), "not-an-id"]) {
      await expectHidden(mute(c2Engineer, projectId), projectId);
      await expectHidden(unmute(c2Engineer, projectId), projectId);
    }
  });
});

describe("watched items", () => {
  it("tell the raiser and the Submitter of the Code, with K1 by name only; never K1, which issued it, nor C2", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Cable trays");
    await drainOutbox(worker);
    await issue(id, "approve_a");
    await drainOutbox(worker);
    const history: WorkItemHistory = (await ok(at.c1Pm.get(`/v1/work-items/${id}/history`), 200)).json();
    const code = history.events.find((e) => e.outcome === "A")!;
    for (const who of [at.c1Engineer, at.c1Pm]) {
      const [n, ...more] = (await watched(who, id)).filter((x) => x.event?.type === "issue_code");
      expect(more).toEqual([]);
      expect(n).toMatchObject({ kind: "watched_event", title: "Cable trays", step: null, readAt: null });
      expect(n!.event).toEqual({ type: "issue_code", outcome: "A", transition: { en: "Approve · A", ar: "اعتماد · A" }, companyName: code.by.companyName });
      // Nothing of K1's people, nor the Remarks.
      expect(JSON.stringify(n)).not.toMatch(/Noted|Test Member/);
    }
    expect(await kinds(at.k1Manager, id)).toEqual(["step_reached"]);
    for (const who of [k1Manager2, c2Engineer]) expect(await watched(who, id)).toEqual([]);
  });

  it("never tell a watcher of their own move, nor tell them twice when it waits on them", async () => {
    const id = await inReview("Busbars");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
    await ok(at.c1Pm.post(`/v1/work-items/${id}/transitions`, { transition: "return", answers: { reason: "Wrong tray size" }, idempotencyKey: randomUUID() }));
    await drainOutbox(worker);
    // The raiser watches, and the Return waits on them: one "Step reached", no more.
    expect(await kinds(at.c1Engineer, id)).toEqual(["step_reached"]);
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(at.c1Pm, id, "submit");
    await drainOutbox(worker);
    // The PM's own Submit: nothing for the PM; the raiser hears of it as a watcher.
    expect(await watched(at.c1Pm, id)).toEqual([]);
    expect((await watched(at.c1Engineer, id)).map((n) => n.event?.transition?.en)).toEqual(["Submit"]);
  });

  it("scenario 68: a watching OR Member narrowed off the MAR's Trade gets nothing when K1 issues Code A", async () => {
    const orEngineer = await projectMember(api, or, orParticipantId, ["engineer"]);
    const narrowed = await projectMember(api, or, orParticipantId, ["engineer"]);
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Switchgear");
    await drainOutbox(worker);
    await watch(orEngineer, id);
    await watch(narrowed, id);
    const narrowedId = await meOf(narrowed);
    await ok(or.caller.request("PUT", `/v1/participants/${orParticipantId}/members/${narrowedId}/visibility`, { trade: only(at.mechanical), location: all }));
    await issue(id, "approve_a");
    await drainOutbox(worker);
    expect(await kinds(orEngineer, id)).toEqual(["watched_event"]);
    // Not in-app, not routed to email either.
    expect((await routed(id)).filter((r) => r.member_id === narrowedId)).toEqual([]);
  });

  it("notify a watcher who ticked only A and B of Code A, not of Code C", async () => {
    const watcher = await projectMember(api, c1, at.c1ParticipantId, ["engineer"]);
    await saveSettings(watcher, { settings: { watched: { inApp: true, email: "digest", outcomes: ["A", "B"] } } });
    const a = await submitted(at, at.c1Engineer, at.c1Pm, "Luminaires");
    const c = await submitted(at, at.c1Engineer, at.c1Pm, "Sockets");
    await drainOutbox(worker);
    await watch(watcher, a);
    await watch(watcher, c);
    await issue(a, "approve_a");
    await issue(c, "revise_c");
    await drainOutbox(worker);
    expect((await about(watcher, a)).map((n) => n.event?.outcome)).toEqual(["A"]);
    expect(await about(watcher, c)).toEqual([]);
    // Every outcome is ticked by default.
    expect((await watched(at.c1Engineer, c)).map((n) => n.event?.outcome)).toEqual(["C", null]); // the Code, and the Submit before it
  });

  it("tell the chain's watchers of a new Revision, never its raiser, nor another Company before it is Submitted (V1)", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Conduits");
    await issue(id, "revise_c");
    await watch(at.k1Manager, id);
    await drainOutbox(worker);
    const rev = (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await drainOutbox(worker);
    expect((await about(at.c1Pm, rev)).map((n) => n.event?.type)).toEqual(["revision_created"]);
    expect(await about(at.c1Engineer, rev)).toEqual([]);
    expect((await routed(rev)).map((r) => r.member_id)).toEqual([await meOf(at.c1Pm)]);
  });
});

describe("a move inside another Company (V5)", () => {
  const TYPE = "NTFSB";
  let item = "";
  let k1Engineer: Caller;

  beforeAll(async () => {
    await addSendBackType(migrator, TYPE, { en: "Notified submittal", ar: "اعتماد مُبلّغ" }, {
      sections: [
        {
          key: "material",
          title: bilingual("Material"),
          fields: [
            { key: "model", type: "text", label: bilingual("Model") },
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
    });
    k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
    const res = await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Pumps", answers: { model: "P1", trade: at.electrical, location: at.buildingA } }),
      201,
    );
    item = res.json().id;
    await take(at.c1Engineer, item, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${item}/claim`));
    await take(at.c1Pm, item, "submit");
    await watch(k1Engineer, item);
    await drainOutbox(worker);
  });

  it("reaches only that Company's watchers: K1 sending it to its manager tells C1 nothing", async () => {
    const before = { engineer: (await about(at.c1Engineer, item)).length, pm: (await about(at.c1Pm, item)).length };
    await ok(at.k1Manager.post(`/v1/work-items/${item}/claim`));
    await take(at.k1Manager, item, "send_to_manager");
    await drainOutbox(worker);
    expect((await about(at.c1Engineer, item)).length).toBe(before.engineer);
    expect((await about(at.c1Pm, item)).length).toBe(before.pm);
    // K1's own watcher hears of it.
    expect((await watched(k1Engineer, item)).map((n) => n.event?.transition?.en)).toEqual(["Send to Manager"]);
  });
});

describe("mute and the bell's switch", () => {
  it("each silence the bell, and the item still waits on them (Need My Action is unaffected)", async () => {
    const pmMuted = await projectMember(api, c1, at.c1ParticipantId, ["project_manager"]);
    const pmOff = await projectMember(api, c1, at.c1ParticipantId, ["project_manager"]);
    await ok(mute(pmMuted, at.projectId));
    await saveSettings(pmOff, { settings: { step_reached: { inApp: false, email: "immediate" } } });
    const id = await inReview("Cable ladders");
    await drainOutbox(worker);

    expect(await kinds(at.c1Pm, id)).toEqual(["step_reached"]);
    for (const who of [pmMuted, pmOff]) {
      expect(await about(who, id)).toEqual([]);
      expect((await detail(who, id)).actions.claim).toBe(true);
    }
    // The bell's switch off still emails; a mute sends nothing at all.
    const byMember = new Map((await routed(id)).map((r) => [r.member_id, { in_app: r.in_app, email: r.email }]));
    expect(byMember.get(await meOf(at.c1Pm))).toEqual({ in_app: true, email: "immediate" });
    expect(byMember.get(await meOf(pmOff))).toEqual({ in_app: false, email: "immediate" });
    expect(byMember.has(await meOf(pmMuted))).toBe(false);
  });

  it("pausing email keeps the bell and routes no email", async () => {
    const pmPaused = await projectMember(api, c1, at.c1ParticipantId, ["project_manager"]);
    await saveSettings(pmPaused, { emailPaused: true });
    const id = await inReview("Trunking");
    await drainOutbox(worker);
    expect(await kinds(pmPaused, id)).toEqual(["step_reached"]);
    const pausedId = await meOf(pmPaused);
    expect((await routed(id)).filter((r) => r.member_id === pausedId)).toEqual([{ member_id: pausedId, kind: "step_reached", in_app: true, email: "none" }]);
  });
});

describe("a claim (scenario 70)", () => {
  it("withdraws the pool colleagues' unread Step reached, and keeps the claimer's and a read one", async () => {
    const reader = await projectMember(api, k1, k1ParticipantId, ["manager"]);
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Cable tray covers");
    await drainOutbox(worker);
    for (const who of [at.k1Manager, k1Manager2, reader]) expect(await kinds(who, id)).toEqual(["step_reached"]);
    const [read] = await about(reader, id);
    await ok(reader.post("/v1/notifications/read", { ids: [read!.id] }));

    await ok(at.k1Manager.post(`/v1/work-items/${id}/claim`));
    expect(await kinds(at.k1Manager, id)).toEqual(["step_reached"]);
    expect(await about(k1Manager2, id)).toEqual([]);
    expect(await kinds(reader, id)).toEqual(["step_reached"]);
  });
});
