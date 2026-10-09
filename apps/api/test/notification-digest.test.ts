// Seam 1 for the daily email digest (RP-358, spec RP-344 "Email"; visibility.md
// the Notifications row). Notifications routed "daily digest" (by default
// everything on a watched item) collect per Member; the worker's job at 07:00
// Riyadh, Sunday to Thursday, sends each Member one email of what collected,
// grouped by Project, then item, in their language, and nothing on an empty
// day. Every entry is checked again at send time as an immediate email is: an
// item they no longer see, paused email, a muted or a closed Project are left
// out. Driven here as the worker drives it: the scheduled jobs at a chosen
// time, then the outbox.
import { randomUUID } from "node:crypto";
import {
  createDb,
  dailyDigestJob,
  notificationDigestHandler,
  runScheduledJobs,
  withMember,
} from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationDigest, NotificationSettings, NotificationSettingsView, VisibilityGrant } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, ok, only, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "NDIG";
const K1_INTERNAL = /Consultant review|Consultant approval|Send to Manager|مراجعة الاستشاري|اعتماد الاستشاري|إرسال للمدير/;

// The week of Sunday 11 October 2026, Riyadh time.
const riyadh = (day: number, time = "07:00") => new Date(`2026-10-${day}T${time}:00+03:00`);
const SUNDAY = riyadh(11);

/** Every digest the worker sent. */
let digests: NotificationDigest[] = [];
const digestHandler = notificationDigestHandler(async (digest) => void digests.push(digest));
/** Delivers everything due, as the worker does; digests are captured. */
const drain = () => drainOutbox(worker, { digest: digestHandler });

/** The worker's poll at `now`: the scheduled jobs (as if none had run yet), then the outbox. */
async function poll(now: Date) {
  await sql`delete from scheduled_job_run where job = ${dailyDigestJob.name}`.execute(migrator);
  const runs = await runScheduledJobs(worker, [dailyDigestJob], now);
  await drain();
  return runs;
}
const digestsTo = (email: string) => digests.filter((d) => d.to === email);
/** The items of `email`'s digests, with their entries' kinds. */
const itemsTo = (email: string) => digestsTo(email).flatMap((d) => d.projects.flatMap((p) => p.items));

let c1: Company;
let k1: Company;
let or: Company;
let at: Tower;
let k1ParticipantId = "";
let orParticipantId = "";

type Person = { caller: Caller; id: string; email: string };

/** A signed-in Member of `company` on the Project, with `positions`, a name, and that Trade Visibility. */
async function person(company: Company, participantId: string, positions: string[], name = bilingual("Test Member"), trade: VisibilityGrant = all): Promise<Person> {
  const invited = await api.inviteMember(company.caller, { fullName: name });
  const caller = await api.acceptInvitation(invited.invitationToken);
  await api.addProjectMember(company.caller, participantId, invited.id);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/visibility`, { trade, location: all }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/positions`, { positions }));
  return { caller, id: invited.id, email: invited.email };
}

const settingsOf = async (by: Caller): Promise<NotificationSettingsView> => (await ok(by.get("/v1/notification-settings"), 200)).json();
async function saveSettings(by: Caller, change: { settings?: Partial<NotificationSettings>; emailPaused?: boolean; preferredLanguage?: "en" | "ar" }) {
  const now = await settingsOf(by);
  await ok(
    by.request("PUT", "/v1/notification-settings", {
      settings: { ...now.settings, ...change.settings },
      emailPaused: change.emailPaused ?? now.emailPaused,
      preferredLanguage: change.preferredLanguage ?? now.preferredLanguage,
    }),
  );
}

/** A test-Type item C1's `raiser` raises and C1's `pm` Submits to K1. */
async function submittedItem(raiser: Person, pm: Person, title: string, trade = at.electrical): Promise<{ id: string; documentNumber: string }> {
  const res = await ok(
    raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "P1", trade, location: at.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(raiser.caller, id, "send_for_review");
  await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
  await take(pm.caller, id, "submit");
  const documentNumber = (await ok(raiser.caller.get(`/v1/work-items/${id}`), 200)).json().documentNumber as string;
  return { id, documentNumber };
}

/** K1's `signer` takes the item through K1's internal review and issues Code B. */
async function issueCodeB(id: string, signer: Person) {
  await ok(signer.caller.post(`/v1/work-items/${id}/claim`));
  await take(signer.caller, id, "send_to_manager");
  await ok(signer.caller.post(`/v1/work-items/${id}/claim`));
  await ok(signer.caller.post(`/v1/work-items/${id}/transitions`, { transition: "approve_b", answers: {}, idempotencyKey: randomUUID() }));
}

let raiser: Person; // C1 engineer: watches what they raise; the digest by default.
let pm: Person; // C1 PM: the Submitter, so a watcher too; reads email in Arabic.
let signer: Person; // K1 Manager: issues the Code.
let c2Engineer: Person; // Another Contractor: never sees C1's items.

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "NDG");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  orParticipantId = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipantId}/visibility`, { trade: all, location: all }));
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));

  // The test Workflow, with a Code B (no Rabaed Default issues one yet).
  await addSendBackType(migrator, TYPE, { en: "Digested submittal", ar: "اعتماد في الملخص" }, {
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
  }, { withApproveB: true });

  raiser = await person(c1, at.c1ParticipantId, ["engineer"]);
  pm = await person(c1, at.c1ParticipantId, ["project_manager"]);
  signer = await person(k1, k1ParticipantId, ["manager"], { en: "Khalid Signer", ar: "خالد الموقّع" });
  c2Engineer = await person(c2, c2ParticipantId, ["engineer"]);
  await saveSettings(pm.caller, { preferredLanguage: "ar" });
  // What earlier tests left waiting for a digest is not ours to judge.
  await drain();
  await poll(SUNDAY);
  digests = [];
});

describe("a Member with two notifications for the digest", () => {
  let item = { id: "", documentNumber: "" };
  beforeAll(async () => {
    item = await submittedItem(raiser, pm, "Pumps");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
    await poll(SUNDAY);
  });

  it("gets one email: their Project, the item, and what happened to it, oldest first", () => {
    const [digest, ...more] = digestsTo(raiser.email);
    expect(more).toEqual([]);
    expect(digest!.language).toBe("en");
    expect(digest!.projects).toHaveLength(1);
    expect(digest!.projects[0]!.projectId).toBe(at.projectId);
    const [entry] = digest!.projects[0]!.items;
    expect(entry).toMatchObject({ workItemId: item.id, documentNumber: item.documentNumber, subject: "Pumps" });
    const events = entry!.entries.map((e) => e.event);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toMatchObject({ type: "transition", transition: { en: "Submit" } });
    expect(events.at(-1)).toMatchObject({ type: "issue_code", outcome: "B", signerName: { en: "Khalid Signer" } });
  });

  it("names K1 only as a Company: nothing of K1's internal Steps (V14)", () => {
    expect(JSON.stringify(digestsTo(raiser.email))).not.toMatch(K1_INTERNAL);
  });

  it("is in the Member's language for email", () => {
    const [digest] = digestsTo(pm.email);
    expect(digest!.language).toBe("ar");
    expect(digest!.projects[0]!.items.map((i) => i.workItemId)).toEqual([item.id]);
  });

  it("a Member with nothing collected gets nothing; another Contractor nothing of C1's", () => {
    // K1's Steps reached it: emailed at once (the default), not in a digest.
    expect(digestsTo(signer.email)).toEqual([]);
    expect(digestsTo(c2Engineer.email)).toEqual([]);
    expect(JSON.stringify(digests)).not.toContain(c2Engineer.email);
  });

  it("is sent once per morning, and not again the next morning when nothing new collected", async () => {
    expect(await runScheduledJobs(worker, [dailyDigestJob], riyadh(11, "07:05"))).toMatchObject([{ outcome: "already_ran" }]);
    await drain();
    await poll(riyadh(12));
    expect(digestsTo(raiser.email)).toHaveLength(1);
  });
});

describe("Friday and Saturday", () => {
  it("send nothing; what collected goes in Sunday's digest", async () => {
    digests = [];
    const item = await submittedItem(raiser, pm, "Valves");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
    expect(await poll(riyadh(16))).toEqual([]);
    expect(await poll(riyadh(17, "09:00"))).toEqual([]);
    expect(digestsTo(raiser.email)).toEqual([]);
    await poll(riyadh(18));
    expect(itemsTo(raiser.email).map((i) => i.subject)).toEqual(["Valves"]);
  });
});

describe("checked again per entry at send time", () => {
  it("leaves out an item the Member can no longer see, and keeps the rest", async () => {
    digests = [];
    const orEngineer = await person(or, orParticipantId, ["engineer"]);
    const seen = await submittedItem(raiser, pm, "Lights", at.electrical);
    const lost = await submittedItem(raiser, pm, "Chillers", at.mechanical);
    await drain();
    for (const { id } of [seen, lost]) await ok(orEngineer.caller.request("PUT", `/v1/work-items/${id}/watch`));
    for (const { id } of [seen, lost]) await issueCodeB(id, signer);
    await drain();
    await ok(or.caller.request("PUT", `/v1/participants/${orParticipantId}/members/${orEngineer.id}/visibility`, { trade: only(at.electrical), location: all }));
    await poll(SUNDAY);
    expect(itemsTo(orEngineer.email).map((i) => i.workItemId)).toEqual([seen.id]);
    expect(JSON.stringify(digestsTo(orEngineer.email))).not.toContain("Chillers");
  });

  it("sends nothing while email is paused, nor of a muted Project; what was left out is not sent later", async () => {
    digests = [];
    const paused = await person(c1, at.c1ParticipantId, ["engineer"]);
    const muted = await person(c1, at.c1ParticipantId, ["engineer"]);
    const item = await submittedItem(raiser, pm, "Boilers");
    await drain();
    for (const who of [paused, muted]) await ok(who.caller.request("PUT", `/v1/work-items/${item.id}/watch`));
    await issueCodeB(item.id, signer);
    await drain();
    await saveSettings(paused.caller, { emailPaused: true });
    await ok(muted.caller.request("PUT", `/v1/projects/${at.projectId}/mute`));
    await poll(SUNDAY);
    expect(digestsTo(paused.email)).toEqual([]);
    expect(digestsTo(muted.email)).toEqual([]);
    // The raiser, watching the same item, gets it.
    expect(itemsTo(raiser.email).map((i) => i.subject)).toEqual(["Boilers"]);

    await saveSettings(paused.caller, { emailPaused: false });
    await ok(muted.caller.request("DELETE", `/v1/projects/${at.projectId}/mute`));
    await poll(riyadh(12));
    expect(digestsTo(paused.email)).toEqual([]);
    expect(digestsTo(muted.email)).toEqual([]);
  });

  it("an entry moved to immediate email after it was collected is left out", async () => {
    digests = [];
    const item = await submittedItem(raiser, pm, "Fans");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
    await saveSettings(raiser.caller, { settings: { watched: { email: "immediate", outcomes: ["A", "B", "C", "D", "cancelled"] } } });
    await poll(SUNDAY);
    expect(itemsTo(raiser.email)).toEqual([]);
    await saveSettings(raiser.caller, { settings: { watched: { email: "digest", outcomes: ["A", "B", "C", "D", "cancelled"] } } });
  });
});

describe("the digest job", () => {
  it("is the worker's only: a signed-in Member's session is refused", async () => {
    await expect(withMember(worker, raiser.id, (trx) => sql`select app.enqueue_notification_digests()`.execute(trx))).rejects.toThrow(/only the worker/);
    await expect(
      withMember(worker, raiser.id, (trx) => sql`select * from app.take_notification_digest(${randomUUID()}::uuid)`.execute(trx)),
    ).rejects.toThrow(/only the worker/);
  });

  it("a failed send is retried with the same entries", async () => {
    digests = [];
    const item = await submittedItem(raiser, pm, "Pipes");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
    let failing = true;
    const flaky = notificationDigestHandler(async (digest) => {
      if (failing) throw new Error("mail server down");
      digests.push(digest);
    });
    await sql`delete from scheduled_job_run where job = ${dailyDigestJob.name}`.execute(migrator);
    await runScheduledJobs(worker, [dailyDigestJob], SUNDAY);
    await drainOutbox(worker, { digest: flaky });
    failing = false;
    await sql`update outbox set available_at = now() where kind = 'digest' and processed_at is null and dead_at is null`.execute(migrator);
    await drainOutbox(worker, { digest: flaky });
    expect(itemsTo(raiser.email).map((i) => i.subject)).toEqual(["Pipes"]);
  });
});

describe("a new Revision (scenario 75)", () => {
  it("collects for the watchers' digest when it gets its number, never while it is a Draft", async () => {
    const id = await submitted(at, raiser.caller, pm.caller, "Revised conduits");
    const answers = { ...(await detail(at.k1Manager, id)).answers, sample_checked: true, matches_specification: false, verification_note: "Too dim" };
    await ok(at.k1Manager.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
    await ok(at.k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(at.k1Manager.post(`/v1/work-items/${id}/transitions`, { transition: "revise_c", answers: { remarks: "Resubmit" }, idempotencyKey: randomUUID() }));
    await drain();
    await poll(riyadh(14));
    digests = [];

    const rev = (await ok(raiser.caller.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await drain();
    await poll(riyadh(15));
    expect(itemsTo(pm.email).map((i) => i.workItemId)).not.toContain(rev);

    await take(raiser.caller, rev, "send_for_review");
    await drain();
    await poll(riyadh(18));
    const entry = itemsTo(pm.email).find((i) => i.workItemId === rev);
    expect(entry?.documentNumber).toMatch(/ Rev 1$/);
    expect(entry?.entries.map((e) => e.event?.type)).toContain("revision_created");
  });
});

describe("a closed Project", () => {
  it("sends nothing of it", async () => {
    digests = [];
    const item = await submittedItem(raiser, pm, "Pumps 2");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
    await sql`update project set status = 'closed', closed_at = now() where id = ${at.projectId}`.execute(migrator);
    await poll(SUNDAY);
    expect(digestsTo(raiser.email)).toEqual([]);
    expect(digestsTo(pm.email)).toEqual([]);
  });
});
