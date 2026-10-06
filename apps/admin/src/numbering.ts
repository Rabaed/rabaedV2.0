import { randomUUID } from "node:crypto";
import { readNumberingCounters, readNumberingPatterns, readNumberingWorkItemTypes, type Db } from "@rabaed/db";
import {
  counterStartRefusals,
  counterWorkItemTypes,
  countsByParticipant,
  numberingPatternRefusals,
  numberingPatternsInEffect,
  participantCodeRefusals,
  toNumberingCounter,
  toSavedNumberingPattern,
  type AdminCounterStartRequest,
  type AdminNumbering,
  type AdminSaveNumberingPatternRequest,
  type CounterStart,
} from "@rabaed/domain";
import { sql, type NotNull } from "kysely";
import { asEngineer } from "./admin-action.ts";
import { expectOutcome, refusable, type Refusable } from "./refusals.ts";

// Numbering from Rabaed Admin (RP-317; workflow-engine.md §8 "Who sets the pattern").
// A Rabaed Engineer does what the Project Admin does on the Numbering page, with the
// same rules: they live in the database (app.apply_numbering_pattern,
// app.assign_participant_code, app.start_numbering_counter), which the Project Admin's
// functions call too. Every edit is an admin_action with a reason; a refused edit
// rolls back, so it logs nothing. A pattern saved without a separate count per
// Participant records the Engineer as accepting the warning: the numbering_pattern
// row names the admin_action, whose Engineer accepted it and whose `after` says so.

export type NumberingRefusal = (typeof numberingPatternRefusals | typeof participantCodeRefusals | typeof counterStartRefusals)[number];
export type NumberingEditResult<T> = Refusable<T, NumberingRefusal>;

/**
 * A Project's numbering: the patterns in effect, the Participants with their codes, and
 * every counter. Customer data, so logged as a read with the Engineer's reason (V9).
 * Null for a Project that doesn't exist.
 */
export function readProjectNumbering(
  adminDb: Db,
  engineerId: string,
  projectId: string,
  reason: string,
  now: Date,
): Promise<AdminNumbering | null> {
  return asEngineer(adminDb, { engineerId, action: "read_numbering", reason }, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { target: { kind: "project", id: projectId }, result: null };

    const patterns = await readNumberingPatterns(trx, projectId, now);
    const types = await readNumberingWorkItemTypes(trx, projectId);
    const participants = await trx
      .selectFrom("participant as p")
      .innerJoin("company as c", "c.id", "p.company_id")
      .select(["p.id", "p.ordinal", "p.code", "p.code_locked_at", "c.legal_name"])
      .where("p.project_id", "=", projectId)
      .where("p.status", "=", "active")
      .orderBy("p.ordinal")
      // An active Participant always has its position (participant_ordinal_when_joined).
      .$narrowType<{ ordinal: NotNull }>()
      .execute();
    const counters = await readNumberingCounters(trx, projectId);

    const result: AdminNumbering = {
      ...numberingPatternsInEffect(patterns, types),
      participants: participants.map((p) => ({
        id: p.id,
        ordinal: p.ordinal,
        code: p.code,
        codeLocked: p.code_locked_at !== null,
        companyName: p.legal_name,
      })),
      counters: {
        counters: counters.map(toNumberingCounter),
        workItemTypes: counterWorkItemTypes(await readNumberingWorkItemTypes(trx, projectId)),
      },
    };
    return { target: { kind: "project", id: projectId }, after: { counterKeys: counters.map((c) => c.counter_key) }, result };
  });
}

/**
 * Saves the Project's Numbering Pattern (`workItemTypeId` null) or a Work Item Type's
 * override, in effect from now. `before` is what was in effect for that scope.
 */
export function saveNumberingPattern(
  adminDb: Db,
  engineerId: string,
  projectId: string,
  input: AdminSaveNumberingPatternRequest,
  now: Date,
): Promise<NumberingEditResult<void>> {
  const actionId = randomUUID();
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: "set_numbering_pattern", reason: input.reason, id: actionId }, async (trx) => {
      const { pattern } = input;
      const before = (await readNumberingPatterns(trx, projectId, now)).find((p) => p.work_item_type_id === input.workItemTypeId);
      const { rows } = await sql<{ outcome: string }>`
        select app.apply_numbering_pattern(
          ${projectId}::uuid, ${input.workItemTypeId}::uuid, ${JSON.stringify(pattern.segments)}::jsonb, ${pattern.separator},
          ${pattern.seqDigits}::integer, ${JSON.stringify(pattern.countedBy)}::jsonb, ${input.sharedCounterAccepted}, ${now},
          null, ${actionId}::uuid
        ) as outcome
      `.execute(trx);
      expectOutcome(rows[0]!.outcome, "saved", numberingPatternRefusals);
      return {
        target: { kind: "project", id: projectId },
        before: before ? toSavedNumberingPattern(before) : null,
        after: {
          workItemTypeId: input.workItemTypeId,
          pattern,
          // Accepting the shared-counter warning is the Engineer's, when it applied.
          sharedCounterAccepted: !countsByParticipant(pattern),
        },
        result: undefined,
      };
    }),
  );
}

/** Sets a Participant's Participant Code. */
export function setParticipantCode(
  adminDb: Db,
  engineerId: string,
  participantId: string,
  input: { code: string; reason: string },
): Promise<NumberingEditResult<void>> {
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: "set_participant_code", reason: input.reason }, async (trx) => {
      const before = await trx.selectFrom("participant").select(["code", "project_id"]).where("id", "=", participantId).executeTakeFirst();
      const { rows } = await sql<{ outcome: string }>`
        select app.assign_participant_code(${participantId}::uuid, ${input.code}) as outcome
      `.execute(trx);
      expectOutcome(rows[0]!.outcome, "set", participantCodeRefusals);
      return {
        target: { kind: "participant", id: participantId },
        before: { code: before?.code ?? null },
        after: { projectId: before?.project_id, code: input.code.trim().toUpperCase() },
        result: undefined,
      };
    }),
  );
}

/** Sets the starting number of the counter the values fall under, while it has issued nothing. */
export function setNumberingCounterStart(
  adminDb: Db,
  engineerId: string,
  projectId: string,
  input: AdminCounterStartRequest,
  now: Date,
): Promise<NumberingEditResult<CounterStart>> {
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: "set_numbering_counter_start", reason: input.reason }, async (trx) => {
      const { rows } = await sql<{ outcome: string; counter_key: string; next_number: string }>`
        select outcome, counter_key, next_number from app.start_numbering_counter(
          ${projectId}::uuid, ${input.workItemType}, ${input.participantId}::uuid, ${input.tradeId}::uuid,
          ${input.locationId}::uuid, ${input.startingNumber}::integer, ${now})
      `.execute(trx);
      const row = rows[0]!;
      expectOutcome(row.outcome, "set", counterStartRefusals);
      return {
        target: { kind: "project", id: projectId },
        after: { counterKey: row.counter_key, startingNumber: input.startingNumber },
        result: { counterKey: row.counter_key, nextNumber: row.next_number },
      };
    }),
  );
}
