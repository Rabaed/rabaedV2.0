import type { Db } from "@rabaed/db";
import { sql } from "kysely";

/** Whether the acting Member is a Project Admin of the Project (app.current_admin_project_ids). */
export const isProjectAdmin = (trx: Db, projectId: string): Promise<boolean> =>
  sql`select 1 from app.current_admin_project_ids() x where x = ${projectId}::uuid`.execute(trx).then((r) => r.rows.length > 0);
