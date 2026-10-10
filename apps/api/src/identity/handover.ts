import type { Database } from "@rabaed/db";
import type { BilingualText, HandoverPick, HandoverReason, HandoverStep } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { checkedOutcome } from "../outcomes.ts";

// Handover (RP-108, ADR 0018; workflow-engine.md §9). A change that may take a Member
// out of a Step Pool runs inside `handedOver`, in the change's own transaction: the
// pooled Steps they are in the pool of are noted first, the change is made, and every
// Step it leaves without a holder gets the Authorized Person's pick, or the whole
// change is rolled back with the refusal. Only the acting Authorized Person's own
// Company's Steps and Members are ever read (app.handovers_needed; scenario RP-108-1).

/** Why a change wasn't made: the Steps to pick a new holder for, or one nobody else can take. */
export type HandoverRefusal =
  | { ok: false; reason: "handover_needed"; handovers: HandoverStep[] }
  | { ok: false; reason: "nobody_can_take"; step: BilingualText; project: BilingualText };

/** Thrown inside the change's transaction, so that nothing of it is saved. */
class HandoverRefused extends Error {
  constructor(readonly refusal: HandoverRefusal) {
    super(refusal.reason);
  }
}

export type HandoverChange = {
  /** The Member the change may take out of Step Pools. */
  memberId: string;
  /** Only this Participant's Steps; null for every one of theirs (a deactivation). */
  participantId: string | null;
  because: HandoverReason;
  picks: HandoverPick[] | undefined;
  now: Date;
};

type NeededRow = {
  assignment_id: string;
  work_item_id: string;
  project_id: string;
  project_name: BilingualText;
  document_number: string | null;
  title: string;
  step_name: BilingualText;
  candidates: { id: string; fullName: BilingualText }[];
};

/**
 * Makes `change` and the Handovers it needs, in transaction `trx`. A refused change
 * (its result not `ok`) is returned as it is. Throws HandoverRefused, rolling it all
 * back, when a Step has nobody left in its pool, or a Step has no valid pick; run it
 * through `withHandovers`.
 */
export async function handedOver<T extends { ok: boolean }>(
  trx: Transaction<Database>,
  { memberId, participantId, because, picks, now }: HandoverChange,
  change: () => Promise<T>,
): Promise<T> {
  const before = await sql<{ ids: string[] }>`
    select app.handover_pooled_before(${memberId}::uuid, ${participantId}::uuid) as ids
  `.execute(trx);
  const result = await change();
  if (!result.ok) return result;

  const { rows } = await sql<NeededRow>`
    select * from app.handovers_needed(${memberId}::uuid, ${participantId}::uuid, ${before.rows[0]!.ids}::uuid[])
  `.execute(trx);
  const empty = rows.find((r) => r.candidates.length === 0);
  if (empty) throw new HandoverRefused({ ok: false, reason: "nobody_can_take", step: empty.step_name, project: empty.project_name });

  const pickFor = new Map((picks ?? []).map((p) => [p.assignmentId, p.toMemberId]));
  const steps = rows.map((r) => ({ row: r, to: pickFor.get(r.assignment_id) }));
  // Every Step needs a pick from its candidates, a single one included: it is shown, pre-filled.
  if (steps.some(({ row, to }) => !row.candidates.some((c) => c.id === to))) {
    throw new HandoverRefused({ ok: false, reason: "handover_needed", handovers: rows.map(toStep) });
  }
  for (const { row, to } of steps) {
    const { rows: done } = await sql<{ outcome: string }>`
      select app.hand_over_step(${row.assignment_id}::uuid, ${memberId}::uuid, ${to!}::uuid, ${because}, ${now}) as outcome
    `.execute(trx);
    // Listed by app.handovers_needed just now, with that candidate: it can't be refused.
    checkedOutcome(done[0]!.outcome, ["handed_over"]);
  }
  return result;
}

/** Runs a change made with `handedOver`; its HandoverRefused becomes the refusal. */
export async function withHandovers<T>(run: () => Promise<T>): Promise<T | HandoverRefusal> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HandoverRefused) return error.refusal;
    throw error;
  }
}

function toStep(r: NeededRow): HandoverStep {
  return {
    assignmentId: r.assignment_id,
    workItemId: r.work_item_id,
    project: { id: r.project_id, name: r.project_name },
    documentNumber: r.document_number,
    title: r.title,
    step: r.step_name,
    candidates: r.candidates,
  };
}
