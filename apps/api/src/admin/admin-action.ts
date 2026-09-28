import type { AdminActionTable, Database, Db } from "@rabaed/db";
import type { Transaction } from "kysely";

export interface AdminActionContext {
  engineerId: string;
  action: AdminActionTable["action"];
  reason: string;
}

export interface AdminActionOutcome<T> {
  target: { kind: string; id: string };
  before?: unknown;
  after?: unknown;
  result: T;
}

/**
 * Runs a Rabaed Engineer's action on the admin connection and records it in
 * admin_action, with its reason, in the same transaction (visibility.md V9).
 * Every Rabaed Admin write goes through here.
 */
export async function asEngineer<T>(
  adminDb: Db,
  context: AdminActionContext,
  fn: (trx: Transaction<Database>) => Promise<AdminActionOutcome<T>>,
): Promise<T> {
  const reason = context.reason.trim();
  if (!reason) throw new Error("A Rabaed Engineer action needs a reason");
  return adminDb.transaction().execute(async (trx) => {
    const outcome = await fn(trx);
    await trx
      .insertInto("admin_action")
      .values({
        engineer_id: context.engineerId,
        action: context.action,
        target_kind: outcome.target.kind,
        target_id: outcome.target.id,
        reason,
        before: outcome.before === undefined ? null : JSON.stringify(outcome.before),
        after: outcome.after === undefined ? null : JSON.stringify(outcome.after),
      })
      .execute();
    return outcome.result;
  });
}
