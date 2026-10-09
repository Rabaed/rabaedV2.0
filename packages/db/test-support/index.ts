import { sql } from "kysely";
import { withMember, type Db } from "../src/client.ts";
import { notificationDigestHandler, notificationEmailHandler, processOutbox, type OutboxHandler } from "../src/outbox.ts";
import { databaseNameOf, databaseUrlsFromEnv, withDatabaseName, type DatabaseUrls } from "../src/config.ts";
import { stepAgeReportHandler } from "../src/step-age-report.ts";

export { addSendBackWorkflow } from "./send-back-workflow.ts";
export { addRulesWorkflow, rulesFormSchema, type RulesTransition } from "./rules-workflow.ts";

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

/**
 * As the app role, the Project Admin `adminId` invites the Company with CR
 * number `crNumber` in `role`, and its Authorized Person `authorizedPersonId`
 * accepts (ADR 0009). Returns the Participant's id.
 */
export async function joinProject(
  app: Db,
  projectId: string,
  invite: { adminId: string; crNumber: string; role: string },
  authorizedPersonId: string,
): Promise<string> {
  const invited = await withMember(app, invite.adminId, (trx) =>
    sql<{ outcome: string }>`
      select app.add_participant(${projectId}::uuid, ${invite.crNumber}, ${invite.role}, now()) as outcome
    `.execute(trx),
  );
  if (invited.rows[0]!.outcome !== "invited") throw new Error(`invite: ${invited.rows[0]!.outcome}`);
  return withMember(app, authorizedPersonId, async (trx) => {
    // The newest pending invitation: the one just sent.
    const { rows } = await sql<{ participant_id: string }>`select participant_id from app.company_invitations()`.execute(trx);
    const id = rows[0]?.participant_id;
    if (!id) throw new Error("invite: no invitation for the Authorized Person");
    const accepted = await sql<{ outcome: string }>`
      select app.respond_to_invitation(${id}::uuid, true, now()) as outcome
    `.execute(trx);
    if (accepted.rows[0]!.outcome !== "accepted") throw new Error(`accept: ${accepted.rows[0]!.outcome}`);
    return id;
  });
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
