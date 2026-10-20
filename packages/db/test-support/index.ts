/*
 * Test helpers for the seam suites (@rabaed/db/test-support). Look here before writing one.
 * Renaming or moving any of them is a shared-file change (docs/agents/issue-tracker.md, shared files).
 *
 * Re-exported from this file:
 *   addTestWorkflow(run, options)   test-workflow.ts: the Send Back (test) Rabaed Default Workflow, Contractor
 *                                   to Consultant with Returns, Send Backs and a Code; options: withApproveB,
 *                                   withCancel, recommendCode, forward, engineerStep, owner, version, publish,
 *                                   notifications, draftsVisibleTo, screens. `run` runs SQL as the migrator.
 *   addTestScreen(run, key, ...)    test-workflow.ts: a Rabaed Default Screen with a published Version, for `screens`.
 *   approveBActionForm              test-workflow.ts: Code B's Action Form (Remarks and a table of Comments).
 *   addRulesWorkflow(run)           rules-workflow.ts: a Workflow with Restrict and Validate rules, one per Transition.
 *   rulesFormSchema                 rules-workflow.ts: the Form that Workflow is published with.
 *   addActionsWorkflow(run)         actions-workflow.ts: a Workflow whose Transitions carry actions.
 *   actionsFormSchema               actions-workflow.ts: the Form that Workflow is published with.
 *   addOwnerReviewWorkflow(run)     owner-review-workflow.ts: a 1→1→1 Workflow ending with the Owner's review (ADR 0022).
 *   expectedContentSha256, jsonbText   content-hash.ts: the content hash a closed item must carry.
 *   withSignature(run, memberId)    signature.ts: gives a Member a new active Signature, as the owner; returns the id.
 *   withoutSignature(run, memberId) signature.ts: ends the Member's Signature in force, for a test of the gate.
 *   runAsOwner(db)                  signature.ts: a Kysely db (the migrator's) as the `run` those take.
 *   withStamp(run, companyId)       stamp.ts: gives a Company a new Stamp, as the owner; returns the id.
 *   withoutStamp(run, companyId)    stamp.ts: takes the Company's Stamp away, for a test of the gate.
 *   buildSeamTwoTower(app, migrator, options)   seam-two-tower.ts: C1, K1, OW, C2 (each an Authorized Person and Members by
 *                                   Position), a Project they join, its Trade, Locations, Visibility, Positions and a Checklist
 *                                   Template; with call/outcome/take/pickUp as a Member. The options are `SeamTwoOptions`.
 *   wirAtConsultant(tower, options) seam-two-tower.ts: a WIR on `options.type` with the Template copied, Submitted and held
 *                                   by K1's Engineer; returns its id.
 *   c2Draft(tower, options)         seam-two-tower.ts: a Draft C2's Engineer raises in Building B; the positive control
 *                                   beside a refusal to C2 (RP-995). Returns its id.
 *   bilingual(en), digits(n)        seam-two-tower.ts: a name with the same text in both languages; n random digits for a unique code.
 *   joinProject(app, projectId, invite, authorizedPersonId)   join-project.ts: invites a Company and accepts as its Authorized Person.
 * Every Member of the test database has a Signature, and every Company a Stamp, by default (RP-85,
 *   RP-617: no Signature or no Stamp, no Transition): test-defaults.ts installs both when the database is reset.
 * Defined below:
 *   rolledBack(db, fn)              runs fn in a transaction that is always rolled back.
 *   testDatabaseUrls()              the environment's URLs, pointed at `<database>_test`.
 *   drainOutbox(db, handlers?)      runs the outbox until nothing is due; emails, digests and reports go nowhere.
 * Not re-exported (import by path): reset-test-database.ts and global-setup.ts (the test database's lifecycle),
 *   the catalogue checks grants.ts, function-grants.ts, definer-*.ts, id-defaults.ts, item-visibility-tables.ts,
 *   and statement-roles.ts (statementRoles(url): a db recording the role each statement runs as, RP-960).
 *
 * The API tests' helpers are listed in apps/api/test/support/README.md.
 */
import type { Db } from "../src/client.ts";
import { notificationDigestHandler, notificationEmailHandler, processOutbox, type OutboxHandler } from "../src/outbox.ts";
import { databaseNameOf, databaseUrlsFromEnv, withDatabaseName, type DatabaseUrls } from "../src/config.ts";
import { stepAgeReportHandler } from "../src/step-age-report.ts";

export { addTestScreen, addTestWorkflow, approveBActionForm, type TestWorkflowOptions } from "./test-workflow.ts";
export { expectedContentSha256, jsonbText, type HashedDocument } from "./content-hash.ts";
export { addRulesWorkflow, rulesFormSchema, type RulesTransition } from "./rules-workflow.ts";
export { actionsFormSchema, addActionsWorkflow } from "./actions-workflow.ts";
export { addOwnerReviewWorkflow } from "./owner-review-workflow.ts";
export { runAsOwner, withSignature, withoutSignature, type RunAsOwner } from "./signature.ts";
export { withStamp, withoutStamp } from "./stamp.ts";
export { joinProject } from "./join-project.ts";
export {
  bilingual,
  buildSeamTwoTower,
  c2Draft,
  digits,
  wirAtConsultant,
  type SeamTwoCompany,
  type SeamTwoOptions,
  type SeamTwoTower,
  type WirAtConsultantOptions,
} from "./seam-two-tower.ts";
export { addLegacyMarType, LEGACY_MAR, LEGACY_WORKFLOW_NAME, returnInInternalReview } from "./legacy-mar.ts";

class Rollback extends Error {}

/** Runs `fn` in a transaction on `db` that is always rolled back. */
export async function rolledBack(db: Db, fn: (trx: Db) => Promise<void>): Promise<void> {
  await db
    .transaction()
    .execute(async (trx) => {
      await fn(trx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

/**
 * The URLs from the environment, pointed at `<database>_test` so the suites
 * never touch the dev database.
 */
export function testDatabaseUrls(): DatabaseUrls {
  const urls = databaseUrlsFromEnv();
  const name = `${databaseNameOf(urls.app)}_test`;
  return {
    superuser: urls.superuser,
    migrator: withDatabaseName(urls.migrator, name),
    app: withDatabaseName(urls.app, name),
    admin: withDatabaseName(urls.admin, name),
  };
}

/** Takes each notification email as the worker would, and sends it nowhere. */
const discardEmails = notificationEmailHandler(async () => {});
/** Takes each daily digest as the worker would, and sends it nowhere. */
const discardDigests = notificationDigestHandler(async () => {});
/** Takes each weekly Step Age report as the worker would, and sends it nowhere. */
const discardStepAgeReports = stepAgeReportHandler(async () => {});

/**
 * Runs `processOutbox` until nothing is due. One run takes at most 100 rows,
 * oldest first, so after busy test files a single call can leave the row a test
 * waits for undelivered. `db` connects as the app role, with no Member set.
 * Notification emails, digests and weekly reports go nowhere unless `handlers` has an `email`,
 * `digest` or `step_age_report` handler.
 */
export async function drainOutbox(db: Db, handlers: Record<string, OutboxHandler> = {}): Promise<void> {
  for (;;) {
    const run = await processOutbox(db, { handlers: { email: discardEmails, digest: discardDigests, step_age_report: discardStepAgeReports, ...handlers } });
    if (run.processed + run.failed + run.dead === 0) return;
  }
}
