// Seam 1 for the Sent Back notification (RP-356, spec RP-344 "Notifications";
// visibility.md the Notifications row). A Send Back tells the Members of the
// Participant it is sent back to who still see the item, routed by their "Sent
// Back" settings, with the Company that sent it named only by its name (V14). It
// follows the bell's switch and a Project mute, and a closed Project hears nothing.
// (RP-356's Vacancy notification went with the member-level Vacancy: a Member's
// Steps are handed over before they leave, RP-108, handover.test.ts.)
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { type Notification, type NotificationList, type NotificationSettings, type NotificationSettingsView, type WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "SBVAC";
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
let or: Company;
let at: Tower;
let k1ParticipantId = "";
let orParticipantId = "";
let k1Manager2: Caller;
let orEngineer: Caller;
let c2Engineer: Caller;
let c1Narrowed: Caller; // A C1 engineer narrowed off Electrical: never sees these items.

const meOf = async (by: Caller): Promise<string> => (await ok(by.get("/v1/me"), 200)).json().member.id;
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
const mute = (by: Caller, projectId: string) => ok(by.request("PUT", `/v1/projects/${projectId}/mute`));

/** The bell's notifications `by` has about item `id`. */
const about = async (by: Caller, id: string): Promise<Notification[]> =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);
const ofKind = async (by: Caller, id: string, kind: Notification["kind"]) => (await about(by, id)).filter((n) => n.kind === kind);

/** How delivery routed each Member's notifications of `kind` about item `id` (the bell and email). */
const routed = async (id: string, kind: string) =>
  (
    await sql<{ member_id: string; in_app: boolean; email: string }>`
      select member_id, in_app, email from notification where work_item_id = ${id} and kind = ${kind} order by member_id
    `.execute(migrator)
  ).rows;

/** An item of the Send Back Type, on `tower`'s Project, Submitted to K1 and picked up by `holder`. */
async function atConsultant(tower: Tower, title: string, holder: Caller = tower.k1Manager): Promise<string> {
  const res = await ok(
    tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, {
      type: TYPE,
      title,
      answers: { model: "P1", trade: tower.electrical, location: tower.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(tower.c1Engineer, id, "send_for_review");
  await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.c1Pm, id, "submit");
  await ok(holder.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** `holder` takes Send Back `transition` on item `id`. */
const sendBack = (holder: Caller, id: string, transition = "send_back") =>
  ok(holder.post(`/v1/work-items/${id}/transitions`, { transition, confirmed: true, idempotencyKey: randomUUID() }));

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Sent Back submittal", ar: "اعتماد مُرجع" }, schema);
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SBV");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  k1Manager2 = await projectMember(api, k1, k1ParticipantId, ["manager"]);
  orParticipantId = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipantId}/visibility`, { trade: all, location: all }));
  orEngineer = await projectMember(api, or, orParticipantId, ["engineer"]);
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c1Narrowed = await projectMember(api, c1, at.c1ParticipantId, ["engineer"], { trade: only(at.mechanical) });
  // C1's Authorized Person (a Project Member, as its creator) sees all of it.
  await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${c1.company.authorizedPerson.id}/visibility`, { trade: all, location: all }));
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker);
});

describe("a Send Back", () => {
  it("tells C1's Members who see the item, with K1 by name only; never K1, the Owner Representative, C2, or a narrowed C1 Member", async () => {
    const id = await atConsultant(at, "Pumps");
    await drainOutbox(worker);
    await sendBack(at.k1Manager, id);
    await drainOutbox(worker);

    const history: WorkItemHistory = (await ok(at.c1Pm.get(`/v1/work-items/${id}/history`), 200)).json();
    const k1Name = history.events.find((e) => e.transition?.en === "Send Back")!.by.companyName;
    expect(k1Name).toBeTruthy();
    for (const who of [at.c1Engineer, at.c1Pm]) {
      const [n, ...more] = await ofKind(who, id, "sent_back");
      expect(more).toEqual([]);
      expect(n).toMatchObject({ kind: "sent_back", title: "Pumps", step: null, readAt: null });
      expect(n!.event).toEqual({ type: "transition", transition: { en: "Send Back", ar: "إرجاع إلى المقدّم" }, outcome: null, companyName: k1Name });
      // Nothing of K1's people.
      expect(JSON.stringify(n)).not.toMatch(/Test Member/);
    }
    for (const who of [at.k1Manager, k1Manager2, orEngineer, c2Engineer, c1Narrowed]) expect(await ofKind(who, id, "sent_back")).toEqual([]);
  });

  it("is the one notification of it for those it was sent back to: no Step reached, no watched event; other watchers hear of it as before", async () => {
    const id = await atConsultant(at, "Valves");
    await ok(k1Manager2.request("PUT", `/v1/work-items/${id}/watch`));
    await drainOutbox(worker);
    const before = new Map<Caller, string[]>();
    for (const who of [at.c1Engineer, at.c1Pm]) before.set(who, (await about(who, id)).map((n) => n.id));
    await sendBack(at.k1Manager, id);
    await drainOutbox(worker);

    // The PM held Contractor review before, so gets it back; the engineer raised and watches it.
    for (const who of [at.c1Engineer, at.c1Pm]) {
      const added = (await about(who, id)).filter((n) => !before.get(who)!.includes(n.id));
      expect(added.map((n) => n.kind)).toEqual(["sent_back"]);
    }
    expect((await ofKind(k1Manager2, id, "watched_event")).map((n) => n.event?.transition?.en)).toEqual(["Send Back"]);
  });
});

describe("email off, a mute and a closed Project", () => {
  it("a Send Back: email off still shows in the bell; a mute sends nothing", async () => {
    const off = await projectMember(api, c1, at.c1ParticipantId, ["engineer"]);
    const muted = await projectMember(api, c1, at.c1ParticipantId, ["engineer"]);
    await saveSettings(off, { sent_back: { email: "off" } });
    await mute(muted, at.projectId);
    const id = await atConsultant(at, "Strainers");
    await sendBack(at.k1Manager, id);
    await drainOutbox(worker);

    expect(await about(muted, id)).toEqual([]);
    expect((await about(off, id)).length).toBe(1);
    const byMember = new Map((await routed(id, "sent_back")).map((r) => [r.member_id, { in_app: r.in_app, email: r.email }]));
    expect(byMember.get(await meOf(off))).toEqual({ in_app: true, email: "none" });
    expect(byMember.has(await meOf(muted))).toBe(false);
    expect(byMember.get(await meOf(at.c1Pm))).toEqual({ in_app: true, email: "immediate" });
  });

  it("a closed Project: it reaches nobody", async () => {
    const closing = await buildTower(api, { c1, k1 }, "SBC");
    const sentBack = await atConsultant(closing, "Dampers");
    await sendBack(closing.k1Manager, sentBack);
    // Closed before the worker delivers it.
    await sql`update project set status = 'closed', closed_at = now() where id = ${closing.projectId}::uuid`.execute(migrator);
    await drainOutbox(worker);
    expect(await routed(sentBack, "sent_back")).toEqual([]);
  });
});
