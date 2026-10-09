import { withMember, type Db } from "@rabaed/db";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";

/** Whether the acting Member is a Project Admin of the Project (app.current_admin_project_ids). */
export const isProjectAdmin = (trx: Db, projectId: string): Promise<boolean> =>
  sql`select 1 from app.current_admin_project_ids() x where x = ${projectId}::uuid`.execute(trx).then((r) => r.rows.length > 0);

/**
 * A Project Admin's command on the Project's settings (its Stages, its outcome sets):
 * the app.* function `call` run as the Member, its outcome `done` or one of `refusals`.
 */
export const projectAdminCommand = <const R extends string>(
  db: Db,
  memberId: string,
  call: ReturnType<typeof sql<{ outcome: string }>>,
  done: string,
  refusals: readonly R[],
): Promise<{ ok: true } | { ok: false; reason: R }> =>
  withMember(db, memberId, async (trx) => {
    const { rows } = await call.execute(trx);
    return commandResult(rows[0]!.outcome, done, refusals);
  });
