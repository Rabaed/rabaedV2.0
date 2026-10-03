// Seam 1: in-app notifications through the outbox and worker (RP-195;
// workflow-engine.md §5, §5.1 effect 7; visibility.md "Notifications and emails";
// spec scenario 12). A Work Item reaching someone writes an outbox row in the
// Transition's own transaction; the worker delivers it to the Members who hold
// the Step then and still see the item. Notifications show only what the
// recipient may see.
import { randomUUID } from "node:crypto";
import { createDb, deliverNotification, outboxStats, processOutbox, withMember, type OutboxRow } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

type Company = { company: OnboardedCompany; caller: Caller };
type Coverage = { isAll: boolean; valueIds: string[] };
type Member = { id: string; caller: Caller };

const bilingual = (text: string) => ({ en: text, ar: text });
const all: Coverage = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]): Coverage => ({ isAll: false, valueIds });

let c1: Company;
let c1ParticipantId = "";
let projectId = "";
let electrical = "";
let buildingA = "";
let mechanical = "";

let engineer: Member;
let pm: Member; // C1 Project Managers: the Internal Review pool.
let pmRemoved: Member; // Removed from the Project before delivery.
let pmNarrowed: Member; // Narrowed to Mechanical before delivery.
let manager: Member; // K1 Manager: the Consultant review pool.
let k1Engineer: Member;
let c2Engineer: Member;
let engineerPm: Member; // C1 Engineer who is also a PM: in the pool they send to.
let k1: { company: Company; participantId: string };

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

async function projectMember(company: Company, participantId: string, positions: string[]): Promise<Member> {
  const member = await api.inviteMember(company.caller);
  const caller = await api.acceptInvitation(member.invitationToken);
  await api.addProjectMember(company.caller, participantId, member.id);
  await setVisibility(company, participantId, member.id, all);
  if (positions.length) {
    await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  }
  return { id: member.id, caller };
}

const setVisibility = (company: Company, participantId: string, memberId: string, trade: Coverage) =>
  ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${memberId}/visibility`, { trade, location: all }));

async function participant(role: "contractor" | "consultant") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

async function createDraft(title: string, by: Member = engineer): Promise<string> {
  const res = await by.caller.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  // The MAR Form Version 2 needs its Datasheet to leave Draft.
  await attachDatasheet(by.caller, res.json().id);
  return res.json().id;
}

const take = (by: Member, id: string, transition: string, reason = "") =>
  ok(by.caller.post(`/v1/work-items/${id}/transitions`, { transition, reason, idempotencyKey: randomUUID() }));

async function notifications(by: Member): Promise<NotificationList> {
  const res = await by.caller.get("/v1/notifications");
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

/** The notifications `by` has about item `id`. */
const about = async (by: Member, id: string) => (await notifications(by)).notifications.filter((n) => n.workItemId === id);

/** The outbox rows written for item `id`, as the migrator sees them. */
const outboxRows = (id: string) =>
  sql<{ attempts: number; processed_at: Date | null; dead_at: Date | null; last_error: string | null; payload: unknown }>`
    select attempts, processed_at, dead_at, last_error, payload from outbox
    where payload ->> 'work_item_id' = ${id} order by created_at, id
  `
    .execute(migrator)
    .then((r) => r.rows);

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  mechanical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "ME", name: bilingual("Mechanical") })).json().id;
  c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, c1ParticipantId, ["engineer"]);
  pm = await projectMember(c1, c1ParticipantId, ["project_manager"]);
  pmRemoved = await projectMember(c1, c1ParticipantId, ["project_manager"]);
  pmNarrowed = await projectMember(c1, c1ParticipantId, ["project_manager"]);
  k1 = await participant("consultant");
  manager = await projectMember(k1.company, k1.participantId, ["manager"]);
  k1Engineer = await projectMember(k1.company, k1.participantId, ["engineer"]);
  const c2 = await participant("contractor");
  c2Engineer = await projectMember(c2.company, c2.participantId, ["engineer"]);
  engineerPm = await projectMember(c1, c1ParticipantId, ["engineer", "project_manager"]);
  // Anything earlier tests left in the outbox is not ours to judge.
  await processOutbox(worker);
});

describe("Send for Review", () => {
  let id = "";
  beforeAll(async () => {
    id = await createDraft("Cable trays");
    await take(engineer, id, "send_for_review");
  });

  it("writes one outbox row in the Transition's transaction, and notifies nobody before delivery", async () => {
    expect(await outboxRows(id)).toHaveLength(1);
    expect(await about(pm, id)).toEqual([]);
  });

  it("is delivered to the PM pool's Members who still see the item, and nobody else (scenario 12)", async () => {
    await ok(c1.caller.delete(`/v1/participants/${c1ParticipantId}/members/${pmRemoved.id}`));
    await setVisibility(c1, c1ParticipantId, pmNarrowed.id, only(mechanical));
    await processOutbox(worker);

    const [n] = await about(pm, id);
    expect(n).toMatchObject({ workItemId: id, title: "Cable trays", documentNumber: "TWR-MAR-01-0001", readAt: null });
    expect(n!.step).toEqual({ name: { en: "Contractor review", ar: "مراجعة المقاول" } });
    for (const who of [engineer, pmNarrowed, manager, k1Engineer, c2Engineer]) expect(await about(who, id), who.id).toEqual([]);
    expect((await pmRemoved.caller.get("/v1/notifications")).json().notifications).toEqual([]);
    expect((await outboxRows(id))[0]).toMatchObject({ attempts: 0, dead_at: null });
    expect((await outboxRows(id))[0]!.processed_at).not.toBeNull();
  });

  it("counts unread notifications for the bell, and marks one, or all, read", async () => {
    expect((await notifications(pm)).unread).toBe(1);
    const [n] = await about(pm, id);
    // Another Member's notification id marks nothing of theirs.
    await ok(engineer.caller.post("/v1/notifications/read", { ids: [n!.id] }));
    expect((await notifications(pm)).unread).toBe(1);
    await ok(pm.caller.post("/v1/notifications/read", { ids: [n!.id] }));
    expect(await notifications(pm)).toMatchObject({ unread: 0 });
    expect((await about(pm, id))[0]!.readAt).not.toBeNull();
    await ok(pm.caller.post("/v1/notifications/read", {}));
  });

  it("never notifies the Member whose move it was, even when they are in the pool", async () => {
    const own = await createDraft("Cable ladders", engineerPm);
    await take(engineerPm, own, "send_for_review");
    await processOutbox(worker);
    expect(await about(engineerPm, own)).toEqual([]);
    expect(await about(pm, own)).toHaveLength(1);
  });

  it("is delivered once, however often the worker runs", async () => {
    await processOutbox(worker);
    expect(await about(pm, id)).toHaveLength(1);
  });
});

describe("Return and Submit", () => {
  let id = "";
  beforeAll(async () => {
    id = await createDraft("Lighting fixtures");
    await take(engineer, id, "send_for_review");
    await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
    await take(pm, id, "return", "Wrong tray size");
    await processOutbox(worker);
  });

  it("notifies the Engineer the Return comes back to, not the PM who returned it", async () => {
    expect(await about(engineer, id)).toHaveLength(1);
    // Send for Review was delivered only after the PM had claimed and returned it: a
    // Step the item already left notifies nobody.
    expect(await about(pm, id)).toEqual([]);
  });

  it("notifies the Consultant's pool on Submit, never the Consultant's Engineer or the second Contractor", async () => {
    await take(engineer, id, "send_for_review");
    await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
    await take(pm, id, "submit");
    await processOutbox(worker);
    const [n] = await about(manager, id);
    expect(n).toMatchObject({ title: "Lighting fixtures", step: { name: { en: "Consultant review" } } });
    for (const who of [k1Engineer, c2Engineer]) expect(await about(who, id)).toEqual([]);
  });

  it("shows only the recipient's own notifications, with nothing of items that aren't theirs", async () => {
    const mine = await notifications(manager);
    expect(mine.notifications.every((n) => n.workItemId === id)).toBe(true);
    const body = JSON.stringify(mine);
    expect(body).not.toContain("Cable trays");
    expect(body).not.toContain("Wrong tray size");
  });

  it("drops a delivered notification from the list and the count once the recipient no longer sees the item (V12)", async () => {
    expect((await notifications(manager)).unread).toBeGreaterThan(0);
    await setVisibility(k1.company, k1.participantId, manager.id, only(mechanical));
    expect(await notifications(manager)).toEqual({ unread: 0, notifications: [] });
    await setVisibility(k1.company, k1.participantId, manager.id, all);
    expect(await about(manager, id)).toHaveLength(1);
  });
});

describe("a rolled-back Transition", () => {
  it("leaves no outbox row, so nobody is notified", async () => {
    const id = await createDraft("Busbars");
    await expect(
      withMember(worker, engineer.id, async (trx) => {
        const { rows } = await sql<{ outcome: string }>`
          select app.take_transition(${id}::uuid, 'send_for_review', '', '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome
        `.execute(trx);
        expect(rows[0]!.outcome).toBe("applied");
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(await outboxRows(id)).toEqual([]);
    await processOutbox(worker);
    expect(await about(pm, id)).toEqual([]);
  });
});

describe("a failing delivery", () => {
  it("is retried later without blocking other rows, and dead-lettered after the last attempt", async () => {
    const failing = await createDraft("Switchgear");
    const fine = await createDraft("Sockets");
    await take(engineer, failing, "send_for_review");
    await take(engineer, fine, "send_for_review");
    const flaky = async (trx: Parameters<typeof deliverNotification>[0], row: OutboxRow) => {
      if (row.payload.work_item_id === failing) throw new Error("mail server down");
      await deliverNotification(trx, row);
    };

    await processOutbox(worker, { handlers: { notification: flaky }, maxAttempts: 3, retryDelayMs: () => 3_600_000 });
    expect(await about(pm, fine)).toHaveLength(1);
    expect(await outboxRows(failing)).toEqual([
      expect.objectContaining({ attempts: 1, processed_at: null, dead_at: null, last_error: "mail server down" }),
    ]);
    // Not due yet: the next run leaves it alone.
    await processOutbox(worker, { handlers: { notification: flaky }, maxAttempts: 3 });
    expect((await outboxRows(failing))[0]!.attempts).toBe(1);

    await sql`update outbox set available_at = now() where payload ->> 'work_item_id' = ${failing}`.execute(migrator);
    await processOutbox(worker, { handlers: { notification: flaky }, maxAttempts: 3, retryDelayMs: () => 0 });
    const [row] = await outboxRows(failing);
    expect(row).toMatchObject({ attempts: 3, processed_at: null, last_error: "mail server down" });
    expect(row!.dead_at).not.toBeNull();
    expect(await about(pm, failing)).toEqual([]);
  });
});

describe("the outbox", () => {
  it("reports its backlog and oldest age for the worker's log, dead-lettered rows included", async () => {
    const id = await createDraft("Earthing");
    await take(engineer, id, "send_for_review");
    const before = await outboxStats(worker);
    expect(before.backlog).toBeGreaterThanOrEqual(1);
    expect(before.oldestAgeSeconds).toBeGreaterThanOrEqual(0);
    await processOutbox(worker);
    // What is left is dead-lettered: still counted, so the alarms see it.
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from outbox where processed_at is null`.execute(migrator);
    const after = await outboxStats(worker);
    expect(after.backlog).toBe(rows[0]!.n);
    expect(await outboxRows(id)).toEqual([expect.objectContaining({ dead_at: null })]);
    expect((await outboxRows(id))[0]!.processed_at).not.toBeNull();
  });

  it("is read and processed only through the worker's functions, never by a signed-in Member", async () => {
    await expect(withMember(worker, pm.id, (trx) => sql`select * from outbox`.execute(trx))).resolves.toMatchObject({ rows: [] });
    await expect(withMember(worker, pm.id, (trx) => sql`delete from outbox`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(withMember(worker, pm.id, (trx) => sql`select * from app.take_outbox_row()`.execute(trx))).rejects.toThrow(
      /only the worker/,
    );
  });
});
