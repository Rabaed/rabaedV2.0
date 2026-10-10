// Seam 1 for immediate notification emails (RP-357, spec RP-344 "Email";
// visibility.md the Notifications row and scenarios 19 and 69). Delivery routes
// each notification (RP-355); one routed "immediately" is emailed by the worker
// through the outbox, in the recipient's language, and only if, at send time,
// they still see the item and may read the event, email isn't paused, the
// Project isn't muted or closed, and the notification wasn't withdrawn. The
// subject is the Document Number, Subject and what happened; another Company
// appears by name only, with the signer of a final Code (V14).
import { randomUUID } from "node:crypto";
import { createDb, notificationEmailHandler, processOutbox, withMember } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationEmail, NotificationSettings, NotificationSettingsView, VisibilityGrant } from "@rabaed/domain";
import { notificationMessage, renderEmail, type MailMessage, type RenderedEmail } from "@rabaed/mailer";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const WEB_URL = "https://rabaed.test";
const TYPE = "NEMB";
const K1_INTERNAL = /Consultant review|Consultant approval|Send to Manager|مراجعة الاستشاري|اعتماد الاستشاري|إرسال للمدير/;

/** Every email the worker sent, as the mailer would get it. */
let sent: MailMessage[] = [];
const sendEmail = async (email: NotificationEmail) => void sent.push(notificationMessage(email, WEB_URL));
const emailHandler = notificationEmailHandler(sendEmail);
/** Delivers and emails everything due, as the worker does. */
const drain = () => drainOutbox(worker, { email: emailHandler });
/** The emails to `email` since the last reset, rendered. */
const to = (email: string): (RenderedEmail & { message: MailMessage })[] =>
  sent.filter((m) => m.to === email).map((message) => ({ message, ...renderEmail(message.template, message.locale, message.values as never) }));
const about = (email: string, subject: string) => to(email).filter((m) => m.subject.includes(subject));

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
/** Every watched-item event emailed at once. */
const watchImmediately = (by: Caller, outcomes: NotificationSettings["watched"]["outcomes"] = ["A", "B", "C", "D", "cancelled"]) =>
  saveSettings(by, { settings: { watched: { email: "immediate", outcomes } } });

/** A test-Type item C1's `raiser` raises and C1's `pm` Submits to K1. */
async function submittedItem(raiser: Person, pm: Person, title: string): Promise<{ id: string; documentNumber: string }> {
  const res = await ok(
    raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "P1", trade: at.electrical, location: at.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(raiser.caller, id, "send_for_review");
  await ok(pm.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(pm.caller, id, "submit");
  const documentNumber = (await ok(raiser.caller.get(`/v1/work-items/${id}`), 200)).json().documentNumber as string;
  return { id, documentNumber };
}

/** K1's `signer` takes the item through K1's internal review and issues Code B. */
async function issueCodeB(id: string, signer: Person) {
  await ok(signer.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(signer.caller, id, "send_to_manager");
  await ok(signer.caller.post(`/v1/work-items/${id}/pick-up`));
  await ok(signer.caller.post(`/v1/work-items/${id}/transitions`, { transition: "approve_b", answers: {}, confirmed: true, idempotencyKey: randomUUID() }));
}

/** The email outbox rows of the notifications of item `id`, as the migrator sees them. */
const emailRows = async (id: string) =>
  (
    await sql<{ attempts: number; processed_at: Date | null; dead_at: Date | null; last_error: string | null }>`
      select o.attempts, o.processed_at, o.dead_at, o.last_error from outbox o
      join notification n on n.id = (o.payload ->> 'notification_id')::uuid
      where o.kind = 'email' and n.work_item_id = ${id} order by o.created_at, o.id
    `.execute(migrator)
  ).rows;

let raiser: Person; // C1 engineer: watches what they raise; emailed watched events at once.
let pm: Person; // C1 PM: the Submitter; reads email in Arabic.
let signer: Person; // K1 Manager: issues the Code.
let k1Manager: Person; // A second K1 Manager: the review pool.
let c2Engineer: Person; // Another Contractor: never sees C1's items.

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "NEM");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  orParticipantId = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipantId}/visibility`, { trade: all, location: all }));
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));

  // The test Workflow, with a Code B (no Rabaed Default issues one yet).
  await addSendBackType(migrator, TYPE, { en: "Emailed submittal", ar: "اعتماد مُرسل" }, {
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
  pm = await person(c1, at.c1ParticipantId, ["project_manager"], { en: "Layla PM", ar: "ليلى المديرة" });
  signer = await person(k1, k1ParticipantId, ["manager"], { en: "Khalid Signer", ar: "خالد الموقّع" });
  k1Manager = await person(k1, k1ParticipantId, ["manager"]);
  c2Engineer = await person(c2, c2ParticipantId, ["engineer"]);
  await watchImmediately(raiser.caller);
  await watchImmediately(pm.caller);
  await saveSettings(pm.caller, { preferredLanguage: "ar" });
  await watchImmediately(c2Engineer.caller);
  // Anything earlier tests left in the outbox is not ours to judge.
  await drain();
  sent = [];
});

describe("scenario 69: K1 issues Code B on C1's item", () => {
  let item = { id: "", documentNumber: "" };
  beforeAll(async () => {
    item = await submittedItem(raiser, pm, "Pumps");
    await drain();
    await issueCodeB(item.id, signer);
    await drain();
  });

  it("emails the C1 raiser a subject of only the Document Number, Subject and Code B", async () => {
    const [email, ...more] = about(raiser.email, "Code B");
    expect(more).toEqual([]);
    expect(email!.message).toMatchObject({ template: "notification-watched-event", locale: "en" });
    expect(email!.subject).toBe(`\u2066${item.documentNumber}\u2069 · Pumps · Code B`);
  });

  it("names K1 as a Company and the Code's signer, nothing of K1's internal Steps, and links to the item", async () => {
    const [email] = about(raiser.email, "Code B");
    const { rows } = await sql<{ name: { en: string } }>`select legal_name as name from company where id = ${k1.company.companyId}`.execute(migrator);
    const k1Name = rows[0]!.name.en;
    expect(email!.text).toContain(k1Name);
    expect(email!.text).toContain("Khalid Signer");
    expect(email!.text).toContain(`${WEB_URL}/en/work-items/${item.id}`);
    expect(`${email!.subject}\n${email!.text}`).not.toMatch(K1_INTERNAL);
    // Nobody of K1 but the signer.
    expect(email!.text).not.toContain("Test Member");
  });

  it("emails the Submitter in their language, Arabic, with the Document Number left to right", () => {
    const [email, ...more] = about(pm.email, "B");
    expect(more.filter((m) => m.subject.endsWith("الرمز B"))).toEqual([]);
    expect(email!.message.locale).toBe("ar");
    expect(email!.subject).toBe(`\u2066${item.documentNumber}\u2069 · Pumps · الرمز B`);
    expect(email!.html).toContain(`<bdi dir="ltr">${item.documentNumber}</bdi>`);
    expect(email!.text).toContain("خالد الموقّع");
    expect(email!.text).toContain(`${WEB_URL}/ar/work-items/${item.id}`);
  });

  it("scenario 19: sends nothing to C2", () => {
    expect(to(c2Engineer.email)).toEqual([]);
    expect(sent.map((m) => JSON.stringify(m.values)).join()).not.toContain(c2Engineer.email);
  });

  it("emails each notification once, however often the worker runs", async () => {
    const before = sent.length;
    await drain();
    expect(sent.length).toBe(before);
    expect((await emailRows(item.id)).every((r) => r.processed_at !== null && r.dead_at === null)).toBe(true);
  });
});

describe("a Step reached", () => {
  it("is emailed at once by default to the pool, never to the Member whose move it was", async () => {
    const { id, documentNumber } = await submittedItem(raiser, pm, "Valves");
    await drain();
    for (const who of [signer, k1Manager]) {
      const [email, ...more] = to(who.email).filter((m) => m.message.template === "notification-step-reached" && m.subject.includes(documentNumber));
      expect(more).toEqual([]);
      expect(email!.subject).toBe(`\u2066${documentNumber}\u2069 · Valves · Reached you at Consultant review`);
    }
    // The PM Submitted it: the PM's own move tells the PM nothing.
    expect(to(pm.email).filter((m) => m.message.template === "notification-step-reached" && m.subject.includes(documentNumber))).toEqual([]);
    expect(id).not.toBe("");
  });

  it("is emailed by the default 'immediately' choice, which no longer comes with a bell switch", async () => {
    const quiet = await person(k1, k1ParticipantId, ["manager"]);
    await saveSettings(quiet.caller, { settings: { step_reached: { email: "immediate" } } });
    const { documentNumber } = await submittedItem(raiser, pm, "Fans");
    await drain();
    expect(about(quiet.email, documentNumber)).toHaveLength(1);
  });

  it("is not emailed to a pool colleague once another has picked it up before the send (withdrawn)", async () => {
    const colleague = await person(k1, k1ParticipantId, ["manager"]);
    const { id, documentNumber } = await submittedItem(raiser, pm, "Chillers");
    await deliverOnly();
    await ok(signer.caller.post(`/v1/work-items/${id}/pick-up`));
    await sendHeldEmails();
    expect(about(colleague.email, documentNumber)).toEqual([]);
    expect(about(signer.email, documentNumber)).toHaveLength(1);
  });
});

/** Delivers the due notifications, and holds their emails back an hour. */
async function deliverOnly() {
  const hold = async () => {
    throw new Error("held back by the test");
  };
  for (;;) {
    const run = await processOutbox(worker, { handlers: { email: hold }, retryDelayMs: () => 3_600_000 });
    if (run.processed + run.failed + run.dead === 0) return;
  }
}
/** Makes the held emails due, and sends them. */
async function sendHeldEmails() {
  await sql`update outbox set available_at = now() where kind = 'email' and processed_at is null and dead_at is null`.execute(migrator);
  await drain();
}

describe("checked again at send time", () => {
  it("nothing is sent once email is paused, nor for a Project muted, before the send", async () => {
    const paused = await person(c1, at.c1ParticipantId, ["project_manager"]);
    const muted = await person(c1, at.c1ParticipantId, ["project_manager"]);
    const id = (
      await ok(raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Boilers", answers: { model: "P1", trade: at.electrical, location: at.buildingA } }), 201)
    ).json().id as string;
    await take(raiser.caller, id, "send_for_review");
    await deliverOnly();
    await saveSettings(paused.caller, { emailPaused: true });
    await ok(muted.caller.request("PUT", `/v1/projects/${at.projectId}/mute`));
    await sendHeldEmails();
    expect(about(paused.email, "Boilers")).toEqual([]);
    expect(about(muted.email, "Boilers")).toEqual([]);
    // Their colleague in the same pool is emailed.
    expect(about(pm.email, "Boilers")).toHaveLength(1);
  });

  it("nothing is sent when paused or muted at delivery either", async () => {
    const paused = await person(c1, at.c1ParticipantId, ["project_manager"]);
    const muted = await person(c1, at.c1ParticipantId, ["project_manager"]);
    await saveSettings(paused.caller, { emailPaused: true });
    await ok(muted.caller.request("PUT", `/v1/projects/${at.projectId}/mute`));
    const id = (
      await ok(raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Heaters", answers: { model: "P1", trade: at.electrical, location: at.buildingA } }), 201)
    ).json().id as string;
    await take(raiser.caller, id, "send_for_review");
    await drain();
    expect(about(paused.email, "Heaters")).toEqual([]);
    expect(about(muted.email, "Heaters")).toEqual([]);
  });

  it("a watcher who lost access between the event and the send gets nothing", async () => {
    const orEngineer = await person(or, orParticipantId, ["engineer"]);
    await watchImmediately(orEngineer.caller);
    const item = await submittedItem(raiser, pm, "Cooling towers");
    await drain();
    await ok(orEngineer.caller.request("PUT", `/v1/work-items/${item.id}/watch`));
    await issueCodeB(item.id, signer);
    await deliverOnly();
    await ok(or.caller.request("PUT", `/v1/participants/${orParticipantId}/members/${orEngineer.id}/visibility`, { trade: only(at.mechanical), location: all }));
    await sendHeldEmails();
    expect(to(orEngineer.email)).toEqual([]);
    // The raiser, who still sees it, is emailed.
    expect(about(raiser.email, `${item.documentNumber}\u2069 · Cooling towers · Code B`)).toHaveLength(1);
  });
});

describe("a failing send", () => {
  it("is retried later, then dead-lettered after the last attempt, as every outbox row", async () => {
    const { id } = await submittedItem(raiser, pm, "Generators");
    const failing = notificationEmailHandler(async () => {
      throw new Error("mail server down");
    });
    for (;;) {
      const run = await processOutbox(worker, { handlers: { email: failing }, maxAttempts: 2, retryDelayMs: () => 0 });
      if (run.processed + run.failed + run.dead === 0) break;
    }
    const rows = await emailRows(id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ attempts: 2, processed_at: null, last_error: "mail server down" });
      expect(row.dead_at).not.toBeNull();
    }
  });
});

describe("a Send Back (RP-356)", () => {
  it("emails the Members it was sent back to, with K1 by name only; never K1 or C2", async () => {
    const item = await submittedItem(raiser, pm, "Dampers");
    await drain();
    await ok(signer.caller.post(`/v1/work-items/${item.id}/pick-up`));
    await take(signer.caller, item.id, "send_back");
    await drain();
    const { rows } = await sql<{ name: { en: string; ar: string } }>`select legal_name as name from company where id = ${k1.company.companyId}`.execute(migrator);
    const [en] = about(raiser.email, `${item.documentNumber}\u2069 · Dampers · Sent Back to you`);
    expect(en!.message.template).toBe("notification-sent-back");
    expect(en!.text).toContain(rows[0]!.name.en);
    expect(`${en!.subject}\n${en!.text}`).not.toMatch(K1_INTERNAL);
    expect(about(pm.email, `${item.documentNumber}\u2069 · Dampers · أُرجع إليكم`)).toHaveLength(1);
    for (const who of [signer, k1Manager, c2Engineer]) expect(about(who.email, "Sent Back")).toEqual([]);
  });
});

describe("a Vacancy (RP-356)", () => {
  const apEmail = () => c1.company.authorizedPerson.email;

  /** A new item whose Contractor review `holder` picked up, then left the Project: its Step is vacant (as RP-108 will make it). */
  async function vacated(title: string, beforeVacant: () => Promise<void> = async () => {}): Promise<string> {
    const holder = await person(c1, at.c1ParticipantId, ["project_manager"]);
    const id = (
      await ok(raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "P1", trade: at.electrical, location: at.buildingA } }), 201)
    ).json().id as string;
    await take(raiser.caller, id, "send_for_review");
    await ok(holder.caller.post(`/v1/work-items/${id}/pick-up`));
    await drain();
    await beforeVacant();
    await ok(c1.caller.delete(`/v1/participants/${at.c1ParticipantId}/members/${holder.id}`));
    await sql`
      update step_assignment set status = 'vacant', updated_at = now()
      where work_item_id = ${id}::uuid and assignee_member_id = ${holder.id}::uuid and status = 'picked_up'
    `.execute(migrator);
    return id;
  }

  beforeAll(async () => {
    await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${c1.company.authorizedPerson.id}/visibility`, { trade: all, location: all }));
    await saveSettings(c1.caller, { settings: { vacancy: { email: "immediate" } } });
  });

  it("emails C1's Authorized Person which Step is vacant", async () => {
    await vacated("Ducts");
    await drain();
    const [email, ...more] = about(apEmail(), "Ducts");
    expect(more).toEqual([]);
    expect(email!.message.template).toBe("notification-vacancy");
    expect(email!.subject).toMatch(/ · Ducts · Vacancy at Contractor review$/);
  });

  it("sends nothing once the Step is no longer vacant at send time", async () => {
    const id = await vacated("Grilles");
    await deliverOnly();
    await sql`update step_assignment set status = 'pooled', assignee_member_id = null where work_item_id = ${id}::uuid and status = 'vacant'`.execute(migrator);
    await sendHeldEmails();
    expect(about(apEmail(), "Grilles")).toEqual([]);
  });
});

describe("the email job", () => {
  it("is the worker's only: a signed-in Member's session is refused", async () => {
    await expect(
      withMember(worker, raiser.id, (trx) => sql`select * from app.take_notification_email(${randomUUID()}::uuid)`.execute(trx)),
    ).rejects.toThrow(/only the worker/);
  });
});

describe("a closed Project", () => {
  it("sends nothing", async () => {
    const id = (
      await ok(raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Pumps 2", answers: { model: "P1", trade: at.electrical, location: at.buildingA } }), 201)
    ).json().id as string;
    await take(raiser.caller, id, "send_for_review");
    await deliverOnly();
    await sql`update project set status = 'closed', closed_at = now() where id = ${at.projectId}`.execute(migrator);
    await sendHeldEmails();
    expect(about(pm.email, "Pumps 2")).toEqual([]);
    expect((await emailRows(id)).every((r) => r.processed_at !== null)).toBe(true);
  });
});
