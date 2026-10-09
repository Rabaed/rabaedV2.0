import { withMember, type Db } from "@rabaed/db";
import {
  outcomeRefusals,
  type AddOutcomeRequest,
  type BilingualText,
  type ChangeOutcomeRequest,
  type Outcome,
  type TypeOutcomes,
} from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";
import { isProjectAdmin } from "./project-admin.ts";

// A Work Item Type's outcome set on a Project (RP-429, WF-6; workflow-engine.md §1
// "Outcomes"). Every Project Member reads it, as they read the Type (outcome's
// RLS); only a Project Admin changes the Project's copy, through app.add_outcome,
// app.change_outcome and app.reorder_outcomes, each audited. Anyone else gets
// 'not_found'. Rabaed Defaults never change here.

export type OutcomeCommandResult = { ok: true } | { ok: false; reason: (typeof outcomeRefusals)[number] };

/** The outcome set of the Project's Type `typeCode`, in order, for its Project Members; null for anyone else or a Type it doesn't use. */
export function getTypeOutcomes(db: Db, memberId: string, projectId: string, typeCode: string): Promise<TypeOutcomes | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const type = await trx
      .selectFrom("work_item_type")
      .select(["id", "code", "name"])
      .where("code", "=", typeCode)
      .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
      // The Project's own Type of that code first, as app.project_type_id.
      .orderBy(sql`project_id is null`)
      .orderBy("id")
      .executeTakeFirst();
    if (!type) return null;
    const { rows } = await sql<Outcome>`
      select o.code, o.name, o.closing, o.polarity, o.actions
      from outcome o
      where o.project_id = ${projectId}::uuid and o.work_item_type_id = ${type.id}::uuid
      order by o.sort, o.code
    `.execute(trx);
    return { type: { code: type.code, name: type.name as BilingualText }, canEdit: await isProjectAdmin(trx, projectId), outcomes: rows };
  });
}

const command = (db: Db, memberId: string, done: string, call: ReturnType<typeof sql<{ outcome: string }>>) =>
  withMember(db, memberId, async (trx): Promise<OutcomeCommandResult> => {
    const { rows } = await call.execute(trx);
    return commandResult(rows[0]!.outcome, done, outcomeRefusals);
  });

/** A Project Admin adds an outcome to the Project's copy of a Type's set, last in its order. */
export const addOutcome = (db: Db, memberId: string, projectId: string, typeCode: string, input: AddOutcomeRequest) =>
  command(
    db,
    memberId,
    "added",
    sql`select app.add_outcome(${projectId}::uuid, ${typeCode}, ${input.code}, ${JSON.stringify(input.name)}::jsonb, ${input.closing},
      ${input.polarity}, ${JSON.stringify(input.actions)}::jsonb) as outcome`,
  );

/** A Project Admin changes an outcome's names and follow-up actions. */
export const changeOutcome = (db: Db, memberId: string, projectId: string, typeCode: string, code: string, input: ChangeOutcomeRequest) =>
  command(
    db,
    memberId,
    "changed",
    sql`select app.change_outcome(${projectId}::uuid, ${typeCode}, ${code}, ${JSON.stringify(input.name)}::jsonb,
      ${JSON.stringify(input.actions)}::jsonb) as outcome`,
  );

/** A Project Admin puts the set in a new order: every code, each once. */
export const reorderOutcomes = (db: Db, memberId: string, projectId: string, typeCode: string, codes: readonly string[]) =>
  command(db, memberId, "reordered", sql`select app.reorder_outcomes(${projectId}::uuid, ${typeCode}, ${[...codes]}::text[]) as outcome`);
