import { randomUUID } from "node:crypto";
import type { Db } from "@rabaed/db";
import type {
  AdminCounterStartRequest,
  AdminNumbering,
  AdminSaveNumberingPatternRequest,
  BilingualText,
  CounterStart,
  NumberingPattern,
  SavedNumberingPattern,
} from "@rabaed/domain";
import { sql } from "kysely";
import { asEngineer } from "./admin-action.ts";

// Numbering from Rabaed Admin (RP-317; workflow-engine.md §8 "Who sets the pattern").
// A Rabaed Engineer does what the Project Admin does on the Numbering page, with the
// same rules: they live in the database (app.apply_numbering_pattern,
// app.assign_participant_code, app.start_numbering_counter), which the Project Admin's
// functions call too. Every edit is an admin_action with a reason; a refused edit
// rolls back, so it logs nothing. A pattern saved without a separate count per
// Participant records the Engineer as accepting the warning: the numbering_pattern
// row names the admin_action, whose Engineer accepted it and whose `after` says so.

const patternRefusals = ["not_found", "project_closed", "type_not_found", "invalid_pattern", "shared_counter_not_accepted"] as const;
const codeRefusals = ["not_found", "project_closed", "invalid_code", "duplicate_code", "code_in_use"] as const;
const counterRefusals = [
  "not_found",
  "type_not_found",
  "participant_required",
  "trade_required",
  "location_required",
  "value_not_found",
  "project_closed",
  "counter_used",
] as const;

export type NumberingRefusal = (typeof patternRefusals | typeof codeRefusals | typeof counterRefusals)[number];
export type NumberingEditResult<T> = { ok: true; value: T } | { ok: false; reason: NumberingRefusal };

class Refused extends Error {
  constructor(readonly reason: NumberingRefusal) {
    super(reason);
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<NumberingEditResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }
}

/** An outcome the database returned: the success word, or a refusal that rolls the edit back. */
function expectOutcome(outcome: string, success: string, refusals: readonly NumberingRefusal[]): void {
  if (outcome === success) return;
  if ((refusals as readonly string[]).includes(outcome)) throw new Refused(outcome as NumberingRefusal);
  throw new Error(`unexpected numbering outcome: ${outcome}`);
}

type StoredPattern = {
  work_item_type_id: string | null;
  segments: NumberingPattern["segments"];
  separator: NumberingPattern["separator"];
  seq_digits: number;
  seq_scope: number[];
  effective_from: Date;
  shared_counter_accepted_at: Date | null;
};

const toSaved = (r: StoredPattern): SavedNumberingPattern => ({
  pattern: { segments: r.segments, separator: r.separator, seqDigits: r.seq_digits, countedBy: r.seq_scope },
  effectiveFrom: r.effective_from.toISOString(),
  sharedCounterAcceptedAt: r.shared_counter_accepted_at?.toISOString() ?? null,
});

const currentPatterns = (trx: Parameters<Parameters<typeof asEngineer>[2]>[0], projectId: string, at: Date) =>
  sql<StoredPattern>`
    select distinct on (work_item_type_id)
      work_item_type_id, segments, separator, seq_digits, seq_scope, effective_from, shared_counter_accepted_at
    from numbering_pattern
    where project_id = ${projectId}::uuid and effective_from <= greatest(${at}::timestamptz, now())
    order by work_item_type_id, effective_from desc, id desc
  `
    .execute(trx)
    .then((r) => r.rows);

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

    const patterns = await currentPatterns(trx, projectId, now);
    const types = await sql<{ id: string; code: string; name: BilingualText }>`
      select id, code, name from work_item_type where project_id is null or project_id = ${projectId}::uuid order by code, id
    `
      .execute(trx)
      .then((r) => r.rows);
    const participants = await trx
      .selectFrom("participant as p")
      .innerJoin("company as c", "c.id", "p.company_id")
      .select(["p.id", "p.ordinal", "p.code", "p.code_locked_at", "c.legal_name"])
      .where("p.project_id", "=", projectId)
      .where("p.status", "=", "active")
      .orderBy("p.ordinal")
      .execute();
    const counters = await sql<{ counter_key: string; last_value: number; starting_value: number | null }>`
      select counter_key, last_value, starting_value from numbering_counter where project_id = ${projectId}::uuid order by counter_key
    `
      .execute(trx)
      .then((r) => r.rows);
    // The Rabaed Default Types and the Project's own, by code; a Project's own replaces a Default of the same code.
    const typeNames = await trx
      .selectFrom("work_item_type")
      .select(["code", "name"])
      .where((eb) => eb.or([eb("project_id", "=", projectId), eb("project_id", "is", null)]))
      .orderBy("code")
      .orderBy(sql`project_id nulls last`)
      .execute();
    const byCode = new Map<string, BilingualText>();
    for (const t of typeNames) if (!byCode.has(t.code)) byCode.set(t.code, t.name);

    const projectPattern = patterns.find((p) => p.work_item_type_id === null);
    const result: AdminNumbering = {
      project: projectPattern ? toSaved(projectPattern) : null,
      types: types.map((t) => {
        const override = patterns.find((p) => p.work_item_type_id === t.id);
        return { id: t.id, code: t.code, name: t.name, override: override ? toSaved(override) : null };
      }),
      participants: participants.map((p) => ({
        id: p.id,
        ordinal: p.ordinal ?? 0,
        code: p.code,
        codeLocked: p.code_locked_at !== null,
        companyName: p.legal_name,
      })),
      counters: {
        counters: counters.map((c) => ({
          counterKey: c.counter_key,
          lastValue: c.last_value,
          startingNumber: c.starting_value,
          issued: c.starting_value === null || c.last_value !== c.starting_value - 1,
        })),
        workItemTypes: [...byCode].map(([code, name]) => ({ code, name })),
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
      const before = (await currentPatterns(trx, projectId, now)).find((p) => p.work_item_type_id === input.workItemTypeId);
      const { rows } = await sql<{ outcome: string }>`
        select app.apply_numbering_pattern(
          ${projectId}::uuid, ${input.workItemTypeId}::uuid, ${JSON.stringify(pattern.segments)}::jsonb, ${pattern.separator},
          ${pattern.seqDigits}::integer, ${JSON.stringify(pattern.countedBy)}::jsonb, ${input.sharedCounterAccepted}, ${now},
          null, ${actionId}::uuid
        ) as outcome
      `.execute(trx);
      expectOutcome(rows[0]!.outcome, "saved", patternRefusals);
      return {
        target: { kind: "project", id: projectId },
        before: before ? toSaved(before) : null,
        after: {
          workItemTypeId: input.workItemTypeId,
          pattern,
          // Accepting the shared-counter warning is the Engineer's, when it applied.
          sharedCounterAccepted: !pattern.countedBy.some((i) => pattern.segments[i]?.kind === "participant"),
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
      expectOutcome(rows[0]!.outcome, "set", codeRefusals);
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
      expectOutcome(row.outcome, "set", counterRefusals);
      return {
        target: { kind: "project", id: projectId },
        after: { counterKey: row.counter_key, startingNumber: input.startingNumber },
        result: { counterKey: row.counter_key, nextNumber: row.next_number },
      };
    }),
  );
}
