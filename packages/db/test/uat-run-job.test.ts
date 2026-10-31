// Seam 2 for the UAT tool's `uat:run-job` (RP-922, test 6): the daily digest or the weekly Step Age
// report, run now. It queues what the scheduled job would, sends with the worker's own handlers (a fake
// mailer here), and never claims the scheduled run, so the real schedule still runs. `--member` sends
// only that Member's: nobody else's row is queued. `--dry-run` lists who would get one and sends nothing.
// Every email is built on the worker's own connection (rabaed_app, no Member set), so it says exactly
// what the worker's would (Main 4, 2026-10-31: visibility first).
import { randomUUID } from "node:crypto";
import type { NotificationDigest, StepAgeReport } from "@rabaed/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type JobConnections } from "../dev-tools/index.ts";
import { createDb, notificationDigestHandler, runScheduledJobs, stepAgeReportHandler, weeklyStepAgeReportJob, type Db } from "../src/index.ts";
import { buildSeamTwoTower, drainOutbox, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";
import { addSubmittalType, assignHolders as holdersOfAssign, giveAssign, submittalAtK1 } from "./uat-tool-support.ts";
import { statementRoles } from "../test-support/statement-roles.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tool: Db;
let tower: SeamTwoTower;
/** The Submittals Type the weekly report reads (uat-tool-support.ts). */
let submittalType = "";
/** The tool's two connections: it queues as the migrator, and sends on the worker's. */
const jobDbs = (worker: Db = app): JobConnections => ({ migrator: tool, worker });

let digests: NotificationDigest[] = [];
let reports: StepAgeReport[] = [];
const handlers = {
  digest: notificationDigestHandler(async (digest) => void digests.push(digest)),
  step_age_report: stepAgeReportHandler(async (report) => void reports.push(report)),
};

/** Member `id`'s email. */
const emailOf = async (id: string) => (await migrator.query<{ email: string }>("select email from member where id = $1", [id])).rows[0]!.email;
/** How many scheduled runs `job` has recorded. */
const runsOf = async (job: string) => Number((await migrator.query<{ n: string }>("select count(*) as n from scheduled_job_run where job = $1", [job])).rows[0]!.n);
/** Unprocessed outbox rows of `kind` for Member `id`. */
const queuedFor = async (kind: string, id: string) =>
  Number(
    (await migrator.query<{ n: string }>("select count(*) as n from outbox where kind = $1 and processed_at is null and payload ->> 'member_id' = $2", [kind, id])).rows[0]!.n,
  );
/** The tower's Members holding Assign on its Project, by email. */
const assignHolders = () => holdersOfAssign(migrator, tower.projectId);
/** Every Member of the tower's Project, by email. */
async function towerMembers(): Promise<string[]> {
  const { rows } = await migrator.query<{ email: string }>(
    "select m.email from project_member pm join member m on m.id = pm.member_id where pm.project_id = $1 order by m.email",
    [tower.projectId],
  );
  return rows.map((r) => r.email);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tool = createDb(urls.migrator, { max: 1 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RUJ" });
  await giveAssign(migrator, tower);
  submittalType = await addSubmittalType(migrator);
  // C1's Engineer raised it, so watches it: its moves wait for the Engineer's digest (the default).
  await wirAtConsultant(tower, { type: "WIR", title: `Job pour ${Date.now()}` });
  // A Submittal at K1: what the weekly report lists (it covers Submittals only).
  await submittalAtK1(tower, submittalType, `Report trays ${Date.now()}`);
  await drainOutbox(app);
});
afterAll(async () => {
  await migrator?.end();
  await app?.destroy();
  await tool?.destroy();
});

describe("uat:run-job digest", () => {
  it("--dry-run lists who would get one, and queues and sends nothing", async () => {
    const engineer = await emailOf(tower.c1.members.engineer);
    digests = [];
    const run = await runJob(jobDbs(), "digest", { handlers, memberEmail: engineer, dryRun: true });
    expect(run.queued.map((r) => r.email)).toEqual([engineer]);
    expect(run.processed).toEqual([]); // not hidden-from: a dry run sends nothing
    expect(digests).toEqual([]); // not hidden-from: a dry run sends nothing
    expect(await queuedFor("digest", tower.c1.members.engineer)).toBe(0);
  });

  it("queues and sends one digest through the worker's handler, and does not claim the scheduled run", async () => {
    const engineer = await emailOf(tower.c1.members.engineer);
    const claimed = await runsOf("daily_digest");
    digests = [];
    const run = await runJob(jobDbs(), "digest", { handlers, memberEmail: engineer, dryRun: false });
    expect(run.processed.map((r) => r.email)).toEqual([engineer]);
    expect(digests.map((d) => d.to)).toEqual([engineer]);
    expect(digests[0]!.projects.map((p) => p.projectId)).toEqual([tower.projectId]);
    expect(await runsOf("daily_digest")).toBe(claimed);
    expect(await queuedFor("digest", tower.c1.members.engineer)).toBe(0);
  });
});

describe("uat:run-job weekly-report", () => {
  it("sends only to the Members holding Assign", async () => {
    const holders = await assignHolders();
    expect(holders.length).toBeGreaterThan(0);
    const members = await towerMembers();
    expect(members.length).toBeGreaterThan(holders.length);
    reports = [];
    const claimed = await runsOf("weekly_step_age_report");
    await runJob(jobDbs(), "weekly-report", { handlers, dryRun: false });
    const ours = reports.filter((r) => r.projectId === tower.projectId).map((r) => r.to);
    expect(ours.sort()).toEqual(holders);
    expect(await runsOf("weekly_step_age_report")).toBe(claimed);
  });

  it("--member sends only that Member's, and queues nobody else's", async () => {
    const [holder, other] = await assignHolders();
    const holderId = (await migrator.query<{ id: string }>("select id from member where email = $1", [holder])).rows[0]!.id;
    reports = [];
    const run = await runJob(jobDbs(), "weekly-report", { handlers, memberEmail: holder!, dryRun: false });
    expect(new Set(reports.map((r) => r.to))).toEqual(new Set([holder]));
    expect(run.leftOut).toBeGreaterThan(0);
    expect(await queuedFor("step_age_report", holderId)).toBe(0);
    if (other) {
      const otherId = (await migrator.query<{ id: string }>("select id from member where email = $1", [other])).rows[0]!.id;
      expect(await queuedFor("step_age_report", otherId)).toBe(0);
    }
  });

  it("builds every email on the worker's connection: each statement of the sending runs as rabaed_app", async () => {
    const [holder] = await assignHolders();
    const recorded = statementRoles(urls.app);
    try {
      reports = [];
      const run = await runJob(jobDbs(recorded.db), "weekly-report", { handlers, memberEmail: holder!, dryRun: false });
      expect(run.processed.map((r) => r.email)).toEqual([holder]);
      expect(recorded.statements.some((s) => s.sql.includes("app.take_step_age_report"))).toBe(true);
      expect([...new Set(recorded.statements.map((s) => s.role))]).toEqual(["rabaed_app"]);
    } finally {
      await recorded.db.destroy();
    }
  });

  it("sends a Member exactly the report the worker's own scheduled run sends them", async () => {
    const [holder] = await assignHolders();
    reports = [];
    await runJob(jobDbs(), "weekly-report", { handlers, memberEmail: holder!, dryRun: false });
    const fromTool = reports.filter((r) => r.to === holder && r.projectId === tower.projectId);
    expect(fromTool).toHaveLength(1); // not hidden-from: the tool sent the holder one report

    // The worker's run: the scheduled job, due at a Sunday 07:00 in Riyadh (its own name, so no run of
    // another test is in the way), then the outbox as the worker processes it.
    reports = [];
    const job = { ...weeklyStepAgeReportJob, name: `test_${randomUUID()}` };
    expect(await runScheduledJobs(app, [job], new Date("2026-11-01T07:00:00+03:00"))).toMatchObject([{ outcome: "ran" }]);
    await drainOutbox(app, { step_age_report: handlers.step_age_report });
    expect(reports.filter((r) => r.to === holder && r.projectId === tower.projectId)).toEqual(fromTool); // not hidden-from: the tool's report equals the worker's
  });

  it("refuses a --member no Member has", async () => {
    await expect(runJob(jobDbs(), "weekly-report", { handlers, memberEmail: "nobody-at-all@rabaed.test", dryRun: true })).rejects.toThrow(
      "no Member has the email nobody-at-all@rabaed.test",
    );
  });

  it("sends nothing for a closed Project", async () => {
    const [holder] = await assignHolders();
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [tower.projectId]);
    reports = [];
    const run = await runJob(jobDbs(), "weekly-report", { handlers, memberEmail: holder!, dryRun: false });
    expect(reports.filter((r) => r.projectId === tower.projectId)).toEqual([]); // not hidden-from: a closed Project sends nothing
    expect(run.processed.filter((r) => r.projectId === tower.projectId)).toEqual([]); // not hidden-from: a closed Project queues nothing
  });
});
