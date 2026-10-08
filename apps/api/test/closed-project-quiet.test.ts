// Seam 1: a closed Project goes quiet (RP-360, spec RP-344; visibility.md
// scenario 15). When a Project closes with events still in the outbox, the
// worker delivers nothing new for it: no in-app notification, no immediate
// email, no digest (not even an empty digest queued) and no weekly report. What
// was already in the bell stays readable, and so do its items.
//
// No seeded Position holds `assign`, so this file adds a test-only one for the
// weekly report, and removes it again at the end (Positions are shared).
import { randomUUID } from "node:crypto";
import {
  createDb,
  dailyDigestJob,
  notificationDigestHandler,
  notificationEmailHandler,
  runScheduledJobs,
  stepAgeReportHandler,
  weeklyStepAgeReportJob,
} from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationDigest, NotificationEmail, StepAgeReport } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, ok, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const TYPE = "QUIET";
const LEAD = "quiet_lead";
afterAll(async () => {
  await sql`delete from project_member_position where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position_permission where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position where key = ${LEAD}`.execute(migrator);
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

/** Sunday 11 October 2026, 07:00 Riyadh: both the digest and the weekly report are due. */
const SUNDAY = new Date("2026-10-11T07:00:00+03:00");

let emails: NotificationEmail[] = [];
let digests: NotificationDigest[] = [];
let reports: StepAgeReport[] = [];
/** The worker's outbox handlers, every send captured. */
const handlers = {
  email: notificationEmailHandler(async (e) => void emails.push(e)),
  digest: notificationDigestHandler(async (d) => void digests.push(d)),
  step_age_report: stepAgeReportHandler(async (r) => void reports.push(r)),
};
const drain = () => drainOutbox(worker, handlers);
/** The worker's Sunday-morning poll: both scheduled jobs (as if neither had run), then the outbox. */
async function pollSunday() {
  await sql`delete from scheduled_job_run where job in (${dailyDigestJob.name}, ${weeklyStepAgeReportJob.name})`.execute(migrator);
  const runs = await runScheduledJobs(worker, [dailyDigestJob, weeklyStepAgeReportJob], SUNDAY);
  expect(runs.map((r) => r.outcome)).toEqual(["ran", "ran"]);
  await drain();
}

type Person = { caller: Caller; id: string; email: string };
async function person(company: Company, participantId: string, positions: string[]): Promise<Person> {
  const invited = await api.inviteMember(company.caller);
  const caller = await api.acceptInvitation(invited.invitationToken);
  await api.addProjectMember(company.caller, participantId, invited.id);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/visibility`, { trade: all, location: all }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/positions`, { positions }));
  return { caller, id: invited.id, email: invited.email };
}

type Listed = { id: string; workItemId: string };
const bell = async (by: Person): Promise<Listed[]> => (await ok(by.caller.get("/v1/notifications"), 200)).json().notifications;

let at: Tower;
let raiser: Person; // C1 engineer: watches what they raise (watched events go to the digest).
let pm: Person; // C1 PM: Submits, so watches too.
let signer: Person; // K1 Manager: reached by Submitted items, emailed at once.
let lead: Person; // C1 lead holding Assign: gets the weekly report.

async function submittedItem(title: string): Promise<string> {
  const res = await ok(
    raiser.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "P1", trade: at.electrical, location: at.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(raiser.caller, id, "send_for_review");
  await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
  await take(pm.caller, id, "submit");
  return id;
}

async function issueCodeB(id: string) {
  await ok(signer.caller.post(`/v1/work-items/${id}/claim`));
  await take(signer.caller, id, "send_to_manager");
  await ok(signer.caller.post(`/v1/work-items/${id}/claim`));
  await ok(signer.caller.post(`/v1/work-items/${id}/transitions`, { transition: "approve_b", answers: {}, confirmed: true, idempotencyKey: randomUUID() }));
}

let earlier = ""; // Submitted and delivered while the Project was active; Code B left in the outbox.
let pending = ""; // Submitted with its notifications still in the outbox when the Project closes.
const before = new Map<string, Listed[]>();
let reportedWhileActive: StepAgeReport[] = [];

beforeAll(async () => {
  await sql`
    insert into position (owner_kind, base_role, key, name, sort)
    select 'rabaed', r, ${LEAD}, '{"en": "Quiet lead (test)", "ar": "مسؤول الهدوء (اختبار)"}', 99
    from unnest(array['contractor', 'consultant', 'owner', 'owner_representative']) r
    on conflict (base_role, key) do nothing
  `.execute(migrator);
  await sql`
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from position p cross join unnest(array['view', 'assign']) x
    where p.key = ${LEAD}
    on conflict do nothing
  `.execute(migrator);
  await addSendBackType(migrator, TYPE, { en: "Quiet submittal", ar: "اعتماد هادئ" }, {
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

  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "QPC");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  raiser = await person(c1, at.c1ParticipantId, ["engineer"]);
  pm = await person(c1, at.c1ParticipantId, ["project_manager"]);
  signer = await person(k1, k1ParticipantId, ["manager"]);
  lead = await person(c1, at.c1ParticipantId, ["project_manager", LEAD]);

  // While the Project is active: delivered, emailed, and collected for the digest.
  earlier = await submittedItem("Earlier pumps");
  await drain();
  // What earlier test files left behind is not ours to judge.
  await pollSunday();
  reportedWhileActive = reports.filter((r) => r.to === lead.email && r.projectId === at.projectId);
  // Still active: a Code B the watchers will want in their digest.
  await issueCodeB(earlier);
  await drain();
  for (const p of [raiser, pm, signer]) before.set(p.id, await bell(p));

  // Then more happens, and the Project closes before the worker gets to it.
  pending = await submittedItem("Pending valves");
  emails = [];
  digests = [];
  reports = [];
  await sql`update project set status = 'closed', closed_at = now() where id = ${at.projectId}`.execute(migrator);
  await drain();
  await pollSunday();
});

describe("a Project closed with events still in the outbox", () => {
  it("delivers no new in-app notification for it", async () => {
    for (const p of [raiser, pm, signer]) {
      const now = await bell(p);
      expect(now.filter((n) => n.workItemId === pending)).toEqual([]);
      expect(now.map((n) => n.id).sort()).toEqual(before.get(p.id)!.map((n) => n.id).sort());
    }
  });

  it("writes no notification for it at all, not even an email-only one", async () => {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from notification where work_item_id = ${pending}::uuid`.execute(migrator);
    expect(rows[0]!.n).toBe(0);
  });

  it("emails nothing of it", () => {
    expect(emails).toEqual([]);
  });

  it("queues no digest for what was collected before it closed, and sends none", async () => {
    expect(digests.filter((d) => [raiser.email, pm.email].includes(d.to))).toEqual([]);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from outbox
      where kind = 'digest' and payload ->> 'member_id' in (${raiser.id}, ${pm.id})
        and created_at >= (select closed_at from project where id = ${at.projectId}::uuid)
    `.execute(migrator);
    expect(rows[0]!.n).toBe(0);
  });

  it("sends no weekly report of it", () => {
    // While it was active, its Assign holder got one.
    expect(reportedWhileActive).toHaveLength(1);
    expect(reports.filter((r) => r.projectId === at.projectId)).toEqual([]);
  });
});

describe("what stays readable", () => {
  it("lists the notifications already in the bell", async () => {
    expect((await bell(signer)).map((n) => n.workItemId)).toContain(earlier);
    expect((await bell(raiser)).map((n) => n.workItemId)).toContain(earlier);
  });

  it("lists and opens its items", async () => {
    const res = await ok(raiser.caller.get(`/v1/projects/${at.projectId}/work-items`), 200);
    const ids = (res.json().items as { id: string }[]).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([earlier, pending]));
    await ok(raiser.caller.get(`/v1/work-items/${pending}`), 200);
  });
});
