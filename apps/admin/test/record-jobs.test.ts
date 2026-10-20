// A Rabaed Engineer watches the record jobs in Rabaed Admin (RP-670, spec RP-632; ADR 0023;
// workflow-engine.md §5 and §7; visibility.md RP-670-1): a record job that fails is listed with its
// error, a job that ran out of attempts is retried (a fresh job; the dead one is kept as it was),
// and a record's Re-produce history is read. Every read and every retry is an admin_action with the
// Engineer's reason. Customers read none of it: a Member sees "being prepared" or nothing.
//
// A record job is made to fail through `processOutbox` with a handler that throws, as
// apps/api/test/record-checks.test.ts does. Each run is held to the one job under test (it is put
// first in line, and `limit: 1`), so no other test file's outbox rows are touched. The PDF itself is
// that file's business: here the job's handler is a stand-in.
import { createDb, processOutbox, type OutboxHandler } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "../../api/test/support/harness.ts";
import { buildTower, detail, draft, memberOnProject, ok, take, type Tower } from "../../api/test/support/tower.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
const urls = testDatabaseUrls();
// The worker (the app role, no Member), and the tables the seams don't show.
const worker = createDb(urls.app, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await admin.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

// Each test closes an item (a few requests); the first also builds the Project.
const SLOW_MS = 120_000;
const reason = "A customer asked why their record is late, ticket #5120";
const URL_JOBS = (r = reason) => `/v1/record-jobs?reason=${encodeURIComponent(r)}`;

interface Job {
  outboxId: string;
  kind: "record" | "reproduce";
  workItemId: string;
  projectId: string;
  projectName: { en: string; ar: string };
  documentNumber: string | null;
  state: "failing" | "dead";
  error: string;
  attempts: number;
  lastRanAt: string | null;
  nextTryAt: string | null;
}

let at: Tower;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let engineer: { id: string; email: string; browser: Browser };

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RJM");
  const k1ParticipantId = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"])).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"])).caller;
  k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"])).caller;
  engineer = await admin.signedInEngineer();
});

/** A MAR the C1 engineer raises and sends, the C1 PM Submits, K1's PM Approves (Code A): its record job is queued. */
async function closed(subject: string): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
  return id;
}

interface OutboxRow {
  id: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  dead_at: Date | null;
  processed_at: Date | null;
  payload: Record<string, string>;
}
/** The item's rows of `kind`, oldest first: read as the migrator, no seam shows the outbox. */
const rowsOf = async (itemId: string, kind = "documental_record"): Promise<OutboxRow[]> =>
  (
    await sql<OutboxRow>`
      select id, kind, attempts, last_error, dead_at, processed_at, payload from outbox
      where kind = ${kind} and coalesce(payload ->> 'closed_work_item_id', payload ->> 'work_item_id') = ${itemId}
      order by created_at, id
    `.execute(migrator)
  ).rows;

/** Runs the one outbox row `id` and nothing else: first in line, and a run of one. */
async function runOnly(id: string, handlers: Record<string, OutboxHandler>, maxAttempts = 2) {
  await sql`update outbox set available_at = '2000-01-01' where id = ${id}::uuid`.execute(migrator);
  return processOutbox(worker, { handlers, maxAttempts, retryDelayMs: () => 0, limit: 1 });
}
const failsWith = (message: string): Record<string, OutboxHandler> => ({
  documental_record: () => Promise.reject(new Error(message)),
  documental_record_reproduce: () => Promise.reject(new Error(message)),
});
const succeeds: Record<string, OutboxHandler> = { documental_record: async () => {}, documental_record_reproduce: async () => {} };

const jobs = async (by: Browser = engineer.browser, why = reason) => {
  const res = await by.get(URL_JOBS(why));
  expect(res.statusCode, res.body).toBe(200);
  return res.json().jobs as Job[];
};
const jobOf = async (itemId: string) => (await jobs()).filter((j) => j.workItemId === itemId);
const alertsOf = async (itemId: string) => {
  const res = await engineer.browser.get(`/v1/documental-record-alerts?reason=${encodeURIComponent(reason)}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().alerts as { workItemId: string; status: string; problems: string[] }[]).filter((a) => a.workItemId === itemId);
};
const actionsOf = (action: string, target: string | null) =>
  migrator
    .selectFrom("admin_action")
    .select(["id", "target_kind", "target_id", "reason", "after", "engineer_id"])
    .where("action", "=", action as "retry_record_job")
    .where("engineer_id", "=", engineer.id)
    .$if(target !== null, (q) => q.where("target_id", "=", target))
    .execute();

describe("a record job that fails", { timeout: SLOW_MS }, () => {
  let id = "";
  let dead: OutboxRow;
  const error = "the PDF renderer crashed (RP-670 test)";

  it("is listed as failing after an attempt, with its Work Item, error, attempts and when it ran", async () => {
    id = await closed("Cable trays, a job that fails");
    const [job] = await rowsOf(id);
    const run = await runOnly(job!.id, failsWith(error));
    expect(run).toMatchObject({ failed: 1, dead: 0 });

    const listed = await jobOf(id);
    expect(listed).toEqual([
      {
        outboxId: job!.id,
        kind: "record",
        workItemId: id,
        projectId: at.projectId,
        projectName: expect.objectContaining({ en: expect.any(String) }),
        documentNumber: (await detail(c1Pm, id)).documentNumber,
        state: "failing",
        error,
        attempts: 1,
        lastRanAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        nextTryAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
    ]);
    // A failing job is not yet an alert: it still has attempts to come.
    expect(await alertsOf(id)).toEqual([]);
  });

  it("is dead after its last attempt, with no next try, and an alert 'job_failed'", async () => {
    const [job] = await rowsOf(id);
    expect(await runOnly(job!.id, failsWith(error))).toMatchObject({ dead: 1 });
    expect(await jobOf(id)).toEqual([expect.objectContaining({ outboxId: job!.id, state: "dead", error, attempts: 2, nextTryAt: null, lastRanAt: expect.any(String) })]);
    expect(await alertsOf(id)).toEqual([expect.objectContaining({ status: "job_failed", problems: [error] })]);
    dead = (await rowsOf(id))[0]!;
    expect(dead.dead_at).not.toBeNull();
  });

  it("is read with a reason, which is logged; a missing or blank reason is refused", async () => {
    expect((await engineer.browser.get("/v1/record-jobs")).statusCode).toBe(400);
    expect((await engineer.browser.get(URL_JOBS("   "))).statusCode).toBe(400);
    const why = "Reading the list for the logged-reason test";
    await jobs(engineer.browser, why);
    const logged = (await actionsOf("read_record_jobs", null)).filter((a) => a.reason === why);
    expect(logged).toEqual([expect.objectContaining({ target_kind: "documental_record", target_id: null })]);
  });

  it("is retried as a fresh job, the dead one kept as it was, and the retry's reason logged", async () => {
    const retry = await engineer.browser.post(`/v1/record-jobs/${dead.id}/retry`, { reason: "The renderer is fixed, ticket #5121" });
    expect(retry.statusCode, retry.body).toBe(202);

    const [keptDead, fresh] = await rowsOf(id);
    expect(keptDead).toEqual(dead);
    expect(fresh).toMatchObject({ kind: "documental_record", attempts: 0, last_error: null, dead_at: null, processed_at: null, payload: dead.payload });

    const logged = await actionsOf("retry_record_job", id);
    expect(logged).toEqual([expect.objectContaining({ target_kind: "documental_record", reason: "The renderer is fixed, ticket #5121", after: { result: "queued" } })]);
    const { rows } = await sql<{ dead_outbox_id: string; outbox_id: string; admin_action_id: string }>`select * from record_job_retry where dead_outbox_id = ${dead.id}::uuid`.execute(migrator);
    expect(rows).toEqual([expect.objectContaining({ outbox_id: fresh!.id, admin_action_id: logged[0]!.id })]);

    // The dead job leaves the list and the alerts; the fresh one has not failed.
    expect(await jobOf(id)).toEqual([]);
    expect(await alertsOf(id)).toEqual([]);
  });

  it("is retried once: the dead job again is the plain 404", async () => {
    const again = await engineer.browser.post(`/v1/record-jobs/${dead.id}/retry`, { reason: "Again" });
    expect([again.statusCode, again.json()]).toEqual([404, { error: "not_found" }]);
    expect(await rowsOf(id)).toHaveLength(2);
    expect(await actionsOf("retry_record_job", id)).toHaveLength(2);
  });

  it("runs the fresh job through the normal attempts, and leaves nothing to show once it is done", async () => {
    const fresh = (await rowsOf(id))[1]!;
    expect(await runOnly(fresh.id, succeeds)).toMatchObject({ processed: 1 });
    expect((await rowsOf(id))[1]).toMatchObject({ attempts: 0, processed_at: expect.any(Date) });
    expect(await jobOf(id)).toEqual([]);
  });

  it("is the same dead job after a fresh one fails too: listed again, as its own", async () => {
    const other = await closed("Cable ladders, a job that fails twice");
    const [first] = await rowsOf(other);
    await runOnly(first!.id, failsWith(error), 1);
    expect((await retryOf(first!.id)).statusCode).toBe(202);
    const fresh = (await rowsOf(other))[1]!;
    await runOnly(fresh.id, failsWith("still broken"), 1);
    expect(await jobOf(other)).toEqual([expect.objectContaining({ outboxId: fresh.id, state: "dead", error: "still broken", attempts: 1 })]);
    expect(await alertsOf(other)).toEqual([expect.objectContaining({ status: "job_failed", problems: ["still broken"] })]);
  });

  it("is the 409 'already_queued' while a job of the same item is waiting, and the 404 for a row that is not a dead record job", async () => {
    const waiting = await closed("Cable glands, a job that is waiting");
    const [first] = await rowsOf(waiting);
    await runOnly(first!.id, failsWith(error), 1);
    // A job of the same kind for the same item is waiting.
    await sql`insert into outbox (kind, project_id, payload) values ('documental_record', ${at.projectId}::uuid, ${JSON.stringify({ closed_work_item_id: waiting })}::jsonb)`.execute(migrator);
    const busy = await retryOf(first!.id);
    expect([busy.statusCode, busy.json()]).toEqual([409, { error: "already_queued" }]);
    expect(await rowsOf(waiting)).toHaveLength(2);
    expect(await jobOf(waiting)).toEqual([expect.objectContaining({ outboxId: first!.id, state: "dead" })]);

    expect((await retryOf("0198f5c0-0000-7000-8000-000000000000")).statusCode).toBe(404);
    const notDead = (await rowsOf(waiting))[1]!;
    expect((await retryOf(notDead.id)).statusCode).toBe(404);
    expect((await retryOf("not-an-id")).statusCode).toBe(400);
  });

  it("is refused to anyone not signed in, and a retry needs a reason", async () => {
    expect((await admin.browser().get(URL_JOBS())).statusCode).toBe(401);
    expect((await admin.browser().post(`/v1/record-jobs/${dead.id}/retry`, { reason })).statusCode).toBe(401);
    expect((await engineer.browser.post(`/v1/record-jobs/${dead.id}/retry`, {})).statusCode).toBe(400);
    expect((await engineer.browser.post(`/v1/record-jobs/${dead.id}/retry`, { reason: "  " })).statusCode).toBe(400);
  });

  it("RP-670-1: no Member of the Project reads the error, failing or dead", async () => {
    const hidden = "the secret renderer failure RP-670-1";
    const mine = await closed("Cable lugs, a job a Member watches");
    const [job] = await rowsOf(mine);
    await runOnly(job!.id, failsWith(hidden), 2);
    const seen = async () => {
      const bodies = [
        (await ok(c1Pm.get(`/v1/work-items/${mine}`), 200)).body,
        (await ok(k1Pm.get(`/v1/work-items/${mine}`), 200)).body,
        (await ok(c1Pm.get("/v1/notifications"), 200)).body,
        (await ok(c1Pm.get(`/v1/projects/${at.projectId}/work-items`), 200)).body,
        (await ok(c1Pm.get(`/v1/work-items/${mine}/history`), 200)).body,
      ];
      for (const body of bodies) expect(body).not.toContain(hidden);
    };
    // Failing: the record is "being prepared", the job still has attempts.
    expect((await detail(c1Pm, mine)).documentalRecord).toBe("preparing");
    await seen();
    // Dead: nothing is shown at all.
    await runOnly(job!.id, failsWith(hidden), 2);
    expect((await detail(c1Pm, mine)).documentalRecord).toBeNull();
    expect((await detail(k1Pm, mine)).documentalRecord).toBeNull();
    await seen();
  });

  const retryOf = (outboxId: string) => engineer.browser.post(`/v1/record-jobs/${outboxId}/retry`, { reason: "Retrying a record job" });
});

describe("a record's history", { timeout: SLOW_MS }, () => {
  let id = "";
  let pdf: Buffer;
  const key = (n: string) => Buffer.from(n.padEnd(32, "x"));
  const historyUrl = (itemId: string, r = reason) => `/v1/work-items/${itemId}/documental-record/history?reason=${encodeURIComponent(r)}`;
  const history = async () => {
    const res = await engineer.browser.get(historyUrl(id));
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      requests: { requestedAt: string; engineerEmail: string; reason: string; outcome: string; replacedSha256: string | null; newSha256: string | null }[];
      checks: { runKind: string; passed: boolean; problems: string[]; ranAt: string }[];
    };
  };
  const reproduce = (r: string) => engineer.browser.post(`/v1/work-items/${id}/documental-record/reproduce`, { reason: r });
  /** The Re-produce job's side of the worker: what the real handler writes, with the PDFs a test can stand in for. */
  const reproduces = (passed: boolean): Record<string, OutboxHandler> => ({
    documental_record_reproduce: async (trx, row) => {
      const { rows } = await sql<{ result: string }>`
        select app.reproduce_documental_record(
          ${row.id}::uuid, 'replaced/record.pdf', ${key("replaced")}, 1000, ${key("new")}, 1100, now(), ${passed},
          ${JSON.stringify(passed ? [] : ["PDF/A-3 6.1.2: a test finding"])}::jsonb) as result
      `.execute(trx);
      if (rows[0]!.result === "not_found") throw new Error("not a Re-produce to do");
    },
  });
  const latestJob = async () => (await rowsOf(id, "documental_record_reproduce")).at(-1)!;

  beforeAll(async () => {
    id = await closed("Cable clips, a record with a history");
    // Its record job is done (a stand-in); the record itself is written as the worker would have, published.
    const [job] = await rowsOf(id);
    await runOnly(job!.id, succeeds);
    pdf = key("pdf");
    const file = async (storageKey: string, mime: string) =>
      (await sql<{ id: string }>`insert into stored_file (storage_key, sha256, size, mime) values (${storageKey}, ${key(storageKey)}, 10, ${mime}) returning id`.execute(migrator)).rows[0]!.id;
    const base = `projects/${at.projectId}/work-items/${id}/documental-record`;
    const pdfFile = await file(`${base}/record.pdf`, "application/pdf");
    const dataFile = await file(`${base}/record-data.xml`, "application/xml");
    await sql`
      insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
        pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
      values (${at.projectId}::uuid, ${id}::uuid, ${pdfFile}::uuid, ${dataFile}::uuid, '1', 'bilingual', 'A', ${pdf}, now(), ${key("token")}, 'RJMH-0001', 'failed_checks')
    `.execute(migrator);
    await sql`
      insert into documental_record_check (documental_record_id, run_kind, passed, problems)
      select r.id, 'closure', false, '["PDF/A-3 6.1.1: first finding"]'::jsonb from documental_record r where r.work_item_id = ${id}::uuid
    `.execute(migrator);
  });

  it("is read with a reason, which is logged, and is empty before any Re-produce; the checks that ran are listed", async () => {
    expect((await engineer.browser.get(`/v1/work-items/${id}/documental-record/history`)).statusCode).toBe(400);
    expect((await engineer.browser.get(historyUrl(id, "  "))).statusCode).toBe(400);
    const got = await history();
    expect(got.requests).toEqual([]);
    expect(got.checks).toEqual([{ runKind: "closure", passed: false, problems: ["PDF/A-3 6.1.1: first finding"], ranAt: expect.any(String) }]);
    expect(await actionsOf("read_documental_record_history", id)).toEqual([expect.objectContaining({ target_kind: "documental_record", reason })]);
    expect((await admin.browser().get(historyUrl(id))).statusCode).toBe(401);
  });

  it("shows a Re-produce request with the Engineer and reason, waiting while its job waits", async () => {
    expect((await reproduce("First attempt, the seal date bug")).statusCode).toBe(202);
    const { requests } = await history();
    expect(requests).toEqual([
      { requestedAt: expect.any(String), engineerEmail: engineer.email, reason: "First attempt, the seal date bug", outcome: "waiting", replacedSha256: null, newSha256: null },
    ]);
  });

  it("then shows it replaced, with the fingerprints of the replaced and the new PDF", async () => {
    expect(await runOnly((await latestJob()).id, reproduces(true))).toMatchObject({ processed: 1 });
    const { requests, checks } = await history();
    expect(requests).toEqual([
      expect.objectContaining({ outcome: "replaced", replacedSha256: key("replaced").toString("hex"), newSha256: key("new").toString("hex") }),
    ]);
    expect(checks.map((c) => [c.runKind, c.passed])).toEqual([
      ["closure", false],
      ["reproduce", true],
    ]);
  });

  it("shows a Re-produce whose new PDF failed its checks, and one whose job gave up, oldest first", async () => {
    expect((await reproduce("Second attempt")).statusCode).toBe(202);
    await runOnly((await latestJob()).id, reproduces(false));
    expect((await reproduce("Third attempt")).statusCode).toBe(202);
    await runOnly((await latestJob()).id, failsWith("the renderer is down"), 1);
    const { requests, checks } = await history();
    expect(requests.map((r) => [r.reason, r.outcome])).toEqual([
      ["First attempt, the seal date bug", "replaced"],
      ["Second attempt", "checks_failed"],
      ["Third attempt", "job_failed"],
    ]);
    expect(checks.map((c) => c.passed)).toEqual([false, true, false]);
    expect(checks[2]!.problems).toEqual(["PDF/A-3 6.1.2: a test finding"]);
    // The third attempt's job is dead and alerts; retrying it queues the job again, still the third request.
    expect(await jobOf(id)).toEqual([expect.objectContaining({ kind: "reproduce", state: "dead", error: "the renderer is down" })]);
    const retry = await engineer.browser.post(`/v1/record-jobs/${(await latestJob()).id}/retry`, { reason: "Retry the third" });
    expect(retry.statusCode).toBe(202);
    expect((await history()).requests.map((r) => r.outcome)).toEqual(["replaced", "checks_failed", "waiting"]);
    await runOnly((await latestJob()).id, reproduces(true));
    expect((await history()).requests.map((r) => r.outcome)).toEqual(["replaced", "checks_failed", "replaced"]);
  });

  it("is nothing for an item with no Re-produce, and nothing is invented for an unknown item", async () => {
    const res = await engineer.browser.get(historyUrl("0198f5c0-0000-7000-8000-000000000000"));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ requests: [], checks: [] });
  });
});
