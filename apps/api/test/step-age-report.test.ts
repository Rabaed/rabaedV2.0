// Seam 1 for the weekly Step Age report (RP-359, spec RP-344; visibility.md the
// Step Age reports row and scenario 21; workflow-engine.md §10). Each Sunday at
// 07:00 Riyadh time the worker's scheduled job queues a report for every Member
// holding the Assign permission on an active Project, and the outbox sends each
// one, as its recipient may see the items when it is sent: the open items they
// see there, aged through app.step_as_seen (another Company's ages count from
// when the item reached it, V14), with a link to the List showing the same
// items. An empty report, an opted-out recipient and a closed Project get nothing.
//
// No seeded Position holds `assign`, so this file adds a test-only one, and
// removes it again at the end (Positions are shared by every Project).
import { randomUUID } from "node:crypto";
import { createDb, processOutbox, runScheduledJobs, stepAgeReportHandler, weeklyStepAgeReportJob, withMember } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationSettings, NotificationSettingsView, StepAgeReport, VisibilityGrant, WorkItemRow } from "@rabaed/domain";
import { stepAgeReportMessage } from "@rabaed/mailer";
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
  await sql`delete from project_member_position where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position_permission where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position where key = ${LEAD}`.execute(migrator);
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const DAY = 86_400_000;
const WEB_URL = "https://rabaed.test";
const TYPE = "WSAR";
const LEAD = "report_lead";

/** The API's clock: moved forward by `api.later`. */
const now = () => api.now();

type Person = { caller: Caller; id: string; email: string };

/** A signed-in Member of `company` on the Project, with `positions` and that Trade Visibility. */
async function person(company: Company, participantId: string, positions: string[], trade: VisibilityGrant = all): Promise<Person> {
  const invited = await api.inviteMember(company.caller);
  const caller = await api.acceptInvitation(invited.invitationToken);
  await api.addProjectMember(company.caller, participantId, invited.id);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/visibility`, { trade, location: all }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/positions`, { positions }));
  return { caller, id: invited.id, email: invited.email };
}

const settingsOf = async (by: Caller): Promise<NotificationSettingsView> => (await ok(by.get("/v1/notification-settings"), 200)).json();
async function saveSettings(by: Caller, change: { settings?: Partial<NotificationSettings>; emailPaused?: boolean; preferredLanguage?: "en" | "ar" }) {
  const mine = await settingsOf(by);
  await ok(
    by.request("PUT", "/v1/notification-settings", {
      settings: { ...mine.settings, ...change.settings },
      emailPaused: change.emailPaused ?? mine.emailPaused,
      preferredLanguage: change.preferredLanguage ?? mine.preferredLanguage,
    }),
  );
}

/** A test-Type item `raiser` raises on `projectId`, in `trade`; Submitted by `pm` when given. */
async function item(projectId: string, raiser: Person, title: string, trade: string, pm?: Person): Promise<string> {
  const res = await ok(raiser.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title, answers: { model: "P1", trade, location: at.buildingA } }), 201);
  const id = res.json().id as string;
  if (pm) {
    await take(raiser.caller, id, "send_for_review");
    await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
    await take(pm.caller, id, "submit");
  }
  return id;
}

/** Every report the worker sent since the last reset. */
let sent: StepAgeReport[] = [];
/** The worker's handler, its Step Ages counted to the API's clock. */
const capture = stepAgeReportHandler(async (report) => void sent.push(report), now);
/** A Sunday, 08:00 Riyadh time: the report is due. */
const SUNDAY = new Date("2026-10-04T05:00:00Z");
/** The worker's poll on Sunday morning, the job's queueing only (as if it had not run yet this week). */
async function queueWeek() {
  await sql`delete from scheduled_job_run where job = ${weeklyStepAgeReportJob.name}`.execute(migrator);
  const runs = await runScheduledJobs(worker, [weeklyStepAgeReportJob], SUNDAY);
  expect(runs.map((r) => r.outcome)).toEqual(["ran"]);
}
/** Sends every report queued. */
const drain = () => drainOutbox(worker, { step_age_report: capture });
/** The worker on Sunday morning: queues this week's reports and sends them. */
async function sendWeek() {
  await queueWeek();
  await drain();
}
const reportsTo = (p: Person, projectId = at.projectId) => sent.filter((r) => r.to === p.email && r.projectId === projectId);
const reportTo = (p: Person) => {
  const reports = reportsTo(p);
  expect(reports).toHaveLength(1);
  return reports[0]!;
};

/** The rows of the List `by` opens from the report's link. */
async function listFromLink(by: Caller, link: string): Promise<WorkItemRow[]> {
  const url = new URL(link);
  const path = url.pathname.replace(/^\/(en|ar)\/projects\//, "/v1/projects/");
  return (await ok(by.get(`${path}${url.search}`), 200)).json().items;
}

let c1: Company;
let k1: Company;
let c2: Company;
let or: Company;
let at: Tower;
let k1ParticipantId = "";

let c1Lead: Person; // C1 PM holding Assign: gets C1's report.
let c1Engineer: Person; // Raises C1's items; no Assign: no report.
let c1Pm: Person; // Submits C1's items; no Assign.
let k1Lead: Person; // K1 Manager holding Assign; also moves items inside K1.
let c2Lead: Person; // Another Contractor's lead: never C1's items.
let c2Engineer: Person;
let orLead: Person; // Owner Representative (Electrical only) holding Assign: oversight; reads Arabic.

let oldTrays = ""; // C1, Electrical: Submitted 23 days before the report, moved inside K1 8 days before.
let pumps = ""; // C1, Mechanical: Submitted 13 days before.
let valves = ""; // C1's Draft, 3 days old.
let closed = ""; // C1, Electrical: Submitted, then Code B.
let c2Item = ""; // C2, Electrical: Submitted.

beforeAll(async () => {
  await sql`
    insert into position (owner_kind, base_role, key, name, sort)
    select 'rabaed', r, ${LEAD}, '{"en": "Report lead (test)", "ar": "مسؤول التقرير (اختبار)"}', 99
    from unnest(array['contractor', 'consultant', 'owner', 'owner_representative']) r
    on conflict (base_role, key) do nothing
  `.execute(migrator);
  await sql`
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from position p cross join unnest(array['view', 'assign']) x
    where p.key = ${LEAD}
    on conflict do nothing
  `.execute(migrator);
  await addSendBackType(migrator, TYPE, { en: "Weekly report submittal", ar: "اعتماد التقرير الأسبوعي" }, {
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

  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
  or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WSR");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  const orParticipantId = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipantId}/visibility`, { trade: only(at.electrical), location: all }));

  c1Lead = await person(c1, at.c1ParticipantId, ["project_manager", LEAD]);
  c1Engineer = await person(c1, at.c1ParticipantId, ["engineer"]);
  c1Pm = await person(c1, at.c1ParticipantId, ["project_manager"]);
  k1Lead = await person(k1, k1ParticipantId, ["manager", LEAD]);
  c2Lead = await person(c2, c2ParticipantId, ["project_manager", LEAD]);
  c2Engineer = await person(c2, c2ParticipantId, ["engineer"]);
  orLead = await person(or, orParticipantId, ["engineer", LEAD], only(at.electrical));
  await saveSettings(orLead.caller, { preferredLanguage: "ar" });

  oldTrays = await item(at.projectId, c1Engineer, "Old cable trays", at.electrical, c1Pm);
  closed = await item(at.projectId, c1Engineer, "Closed fittings", at.electrical, c1Pm);
  await ok(k1Lead.caller.post(`/v1/work-items/${closed}/claim`));
  await take(k1Lead.caller, closed, "send_to_manager");
  await ok(k1Lead.caller.post(`/v1/work-items/${closed}/claim`));
  await ok(k1Lead.caller.post(`/v1/work-items/${closed}/transitions`, { transition: "approve_b", answers: {}, idempotencyKey: randomUUID() }));
  await api.later(10 * DAY);
  pumps = await item(at.projectId, c1Engineer, "Pumps", at.mechanical, c1Pm);
  c2Item = await item(at.projectId, c2Engineer, "C2 lighting", at.electrical, c2Lead);
  await api.later(5 * DAY);
  // K1 moves the trays inside K1: nobody else's age of it changes (V14).
  await ok(k1Lead.caller.post(`/v1/work-items/${oldTrays}/claim`));
  await take(k1Lead.caller, oldTrays, "send_to_manager");
  await api.later(5 * DAY);
  valves = await item(at.projectId, c1Engineer, "Draft valves", at.electrical);
  await api.later(3 * DAY);
});

describe("one week's reports", () => {
  beforeAll(async () => {
    sent = [];
    await sendWeek();
  });

  it("scenario 21: sends the C1 lead C1's open items only, aged from C1's view, never C2's", () => {
    const report = reportTo(c1Lead);
    const ids = report.items.map((i) => i.workItemId);
    expect(ids).toEqual(expect.arrayContaining([oldTrays, pumps]));
    expect(ids).not.toContain(c2Item);
    expect(ids).not.toContain(closed);
    const trays = report.items.find((i) => i.workItemId === oldTrays)!;
    // 23 days since the Submit: its 4th week; K1's internal move doesn't reset it.
    expect(trays).toMatchObject({ subject: "Old cable trays", stepAgeWeeks: 4, with: { kind: "company" } });
    expect(report.items.find((i) => i.workItemId === pumps)).toMatchObject({ stepAgeWeeks: 2 });
  });

  it("scenario 76: lists no un-numbered Draft, which has no Step Age, though the C1 lead sees it", async () => {
    expect(reportTo(c1Lead).items.map((i) => i.workItemId)).not.toContain(valves);
    expect((await ok(c1Lead.caller.get(`/v1/work-items/${valves}`), 200)).json()).toMatchObject({ documentNumber: null });
  });

  it("links to the List showing the C1 lead exactly the report's items, in the same order, and its 4+ weeks to the List of those", async () => {
    const report = reportTo(c1Lead);
    const { values } = stepAgeReportMessage(report, WEB_URL);
    const rows = await listFromLink(c1Lead.caller, values.link);
    expect(rows.map((r) => r.id)).toEqual(report.items.map((i) => i.workItemId));
    const oldest = await listFromLink(c1Lead.caller, values.oldestLink);
    expect(oldest.map((r) => r.id)).toEqual(report.items.filter((i) => i.stepAgeWeeks >= 4).map((i) => i.workItemId));
    expect(oldest.map((r) => r.id)).toContain(oldTrays);
  });

  it("sends nothing to a C1 engineer or PM without Assign", () => {
    expect(reportsTo(c1Engineer)).toEqual([]);
    expect(reportsTo(c1Pm)).toEqual([]);
  });

  it("sends the C2 lead C2's item and nothing of C1's", () => {
    expect(reportTo(c2Lead).items.map((i) => i.workItemId)).toEqual([c2Item]);
  });

  it("sends the OR lead its oversight items only, within its Visibility, aged from when each reached its holder, in Arabic", async () => {
    const report = reportTo(orLead);
    expect(report.language).toBe("ar");
    // Not C1's Draft (not Submitted), not the Mechanical pumps (outside its Visibility), not the closed item.
    expect(report.items.map((i) => i.workItemId).sort()).toEqual([oldTrays, c2Item].sort());
    expect(report.items.find((i) => i.workItemId === oldTrays)).toMatchObject({ stepAgeWeeks: 4, with: { kind: "company" } });
    const { values, locale } = stepAgeReportMessage(report, WEB_URL);
    expect(locale).toBe("ar");
    const rows = await listFromLink(orLead.caller, values.link);
    expect(rows.map((r) => r.id)).toEqual(report.items.map((i) => i.workItemId));
  });

  it("ages the trays for K1 from K1's own internal Step", () => {
    const report = reportTo(k1Lead);
    expect(report.items.find((i) => i.workItemId === oldTrays)).toMatchObject({ stepAgeWeeks: 2, with: { kind: "own" } });
    expect(report.items.map((i) => i.workItemId)).not.toContain(valves);
  });

  it("sends each report once: the job queues once per Sunday, and a sent report is not sent again", async () => {
    const before = sent.length;
    const again = await runScheduledJobs(worker, [weeklyStepAgeReportJob], new Date(SUNDAY.getTime() + 3_600_000));
    expect(again.map((r) => r.outcome)).toEqual(["already_ran"]);
    await drain();
    expect(sent.length).toBe(before);
  });
});

describe("who gets no report", () => {
  it("skips an empty report", async () => {
    const empty = (await api.createProject(c1.caller, { code: "WSE" })).id;
    const participantId = (await c1.caller.get(`/v1/projects/${empty}/participants`))
      .json()
      .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    await api.addProjectMember(c1.caller, participantId, c1Lead.id);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/members/${c1Lead.id}/positions`, { positions: [LEAD] }));
    sent = [];
    await sendWeek();
    expect(reportsTo(c1Lead, empty)).toEqual([]);
    expect(reportsTo(c1Lead)).toHaveLength(1);
  });

  it("follows the Weekly report group's email setting, Pause all email and the Project's mute", async () => {
    await saveSettings(c1Lead.caller, { settings: { weekly_report: { email: "off" } } });
    await saveSettings(c2Lead.caller, { emailPaused: true });
    await ok(orLead.caller.request("PUT", `/v1/projects/${at.projectId}/mute`));
    try {
      sent = [];
      await sendWeek();
      expect(reportsTo(c1Lead)).toEqual([]);
      expect(reportsTo(c2Lead)).toEqual([]);
      expect(reportsTo(orLead)).toEqual([]);
      expect(reportsTo(k1Lead)).toHaveLength(1);
    } finally {
      await saveSettings(c1Lead.caller, { settings: { weekly_report: { email: "immediate" } } });
      await saveSettings(c2Lead.caller, { emailPaused: false });
      await ok(orLead.caller.request("DELETE", `/v1/projects/${at.projectId}/mute`));
    }
  });

  it("sends nothing for a closed Project, nor for one closed between queueing and sending", async () => {
    await sql`update project set status = 'closed', closed_at = now() where id = ${at.projectId}`.execute(migrator);
    try {
      sent = [];
      await sendWeek();
      await sql`update project set status = 'active', closed_at = null where id = ${at.projectId}`.execute(migrator);
      await queueWeek();
      await sql`update project set status = 'closed', closed_at = now() where id = ${at.projectId}`.execute(migrator);
      await drain();
      expect(sent.filter((r) => r.projectId === at.projectId)).toEqual([]);
    } finally {
      await sql`update project set status = 'active', closed_at = null where id = ${at.projectId}`.execute(migrator);
    }
  });

  it("sends nothing to a Member removed from the Project after the report was queued", async () => {
    await queueWeek();
    await sql`update project_member set status = 'removed' where member_id = ${c2Lead.id} and project_id = ${at.projectId}`.execute(migrator);
    try {
      sent = [];
      await drain();
      expect(reportsTo(c2Lead)).toEqual([]);
      expect(reportsTo(c1Lead)).toHaveLength(1);
    } finally {
      await sql`update project_member set status = 'active' where member_id = ${c2Lead.id} and project_id = ${at.projectId}`.execute(migrator);
    }
  });
});

describe("a failed send", () => {
  it("is retried later, and the report is sent once it goes through", async () => {
    await queueWeek();
    const failing = await processOutbox(worker, {
      handlers: {
        step_age_report: stepAgeReportHandler(async () => {
          throw new Error("mail down");
        }, now),
      },
      retryDelayMs: () => 3_600_000,
    });
    expect(failing.failed).toBeGreaterThan(0);
    sent = [];
    // Not retried at once: only after its retry delay.
    await drain();
    expect(sent).toEqual([]);
    await sql`update outbox set available_at = now() where kind = 'step_age_report' and processed_at is null and dead_at is null`.execute(migrator);
    await drain();
    expect(reportsTo(c1Lead)).toHaveLength(1);
  });

  it("can't be queued or taken by the app role with a Member set", async () => {
    await expect(withMember(worker, c1Lead.id, (trx) => sql`select * from app.take_step_age_report(${randomUUID()}::uuid)`.execute(trx))).rejects.toThrow();
    await expect(withMember(worker, c1Lead.id, (trx) => sql`select app.enqueue_step_age_reports()`.execute(trx))).rejects.toThrow();
  });
});
