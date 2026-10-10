import { withMember, type Database, type Db } from "@rabaed/db";
import type { BilingualText, HandoverPick, HandoverReason, HandoverStep } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { checkedOutcome } from "../outcomes.ts";

// Handover (RP-108, ADR 0018; workflow-engine.md §9). A change that may take Members
// out of a Step Pool runs through `handedOver`, in one transaction: the pooled Steps
// they are in the pool of are noted first, the change is made, and every Step it
// leaves without a holder gets the pick of the Member making the change, or the whole
// change is rolled back with the refusal. Only that Member's own Company's Steps and
// Members are ever listed (app.handovers_needed; scenario RP-108-1), an item they don't
// see by its Step and Project only (RP-108-2); another Company's Project Admin
// narrowing a Participant reads only how many of its Steps wait, and whose (RP-108-3).

/** Why a change wasn't made: the Steps to pick a new holder for, one nobody else can take, or another Company's. */
export type HandoverRefusal =
  | { ok: false; reason: "handover_needed"; handovers: HandoverStep[] }
  | { ok: false; reason: "nobody_can_take"; step: BilingualText; project: BilingualText }
  | { ok: false; reason: "other_company_handover"; steps: number; company: BilingualText };

/** Thrown inside the change's transaction, so that nothing of it is saved. */
class HandoverRefused extends Error {
  constructor(readonly refusal: HandoverRefusal) {
    super(refusal.reason);
  }
}

/** Whose Steps a change may take out of Step Pools, why, and the picks sent with it. */
export type HandoverChange = {
  /** The Member the change is about; null for every Member of `participantId` (its Visibility). */
  memberId: string | null;
  /** Only this Participant's Steps; null for every one of the Member's (a deactivation). */
  participantId: string | null;
  because: HandoverReason;
  picks: HandoverPick[] | undefined;
  now: Date;
};

type NeededRow = {
  assignment_id: string;
  project_id: string;
  project_name: BilingualText;
  step_name: BilingualText;
  /** Null, with the two after it, for an item the Member making the change doesn't see. */
  work_item_id: string | null;
  document_number: string | null;
  title: string | null;
  holder: { id: string; fullName: BilingualText } | null;
  candidates: { id: string; fullName: BilingualText }[];
};

/**
 * Runs `change` as Member `actorId`, in one transaction with the Handovers it needs
 * (`handover`). A refused change (its result not `ok`) is returned as it is; so is the
 * database refusing the Member (`forbidden`), and a Handover refusal, with nothing saved.
 */
export function handedOver<T extends { ok: boolean }>(
  db: Db,
  actorId: string,
  handover: HandoverChange,
  change: (trx: Transaction<Database>) => Promise<T>,
): Promise<T | Forbidden | HandoverRefusal> {
  return refusedAsForbidden(async () => {
    try {
      return await withMember(db, actorId, (trx) => inTransaction(trx, handover, () => change(trx)));
    } catch (error) {
      if (error instanceof HandoverRefused) return error.refusal;
      throw error;
    }
  });
}

/** The change and its Handovers in `trx`; throws HandoverRefused to roll it all back. */
async function inTransaction<T extends { ok: boolean }>(
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
  // Another Company's Participant: how many of its Steps wait, and whose; nothing else (V14).
  if (rows.length === 0 && memberId === null && participantId !== null) {
    const { rows: waiting } = await sql<{ steps: number; company_name: BilingualText }>`
      select steps, company_name from app.handovers_waiting(${participantId}::uuid)
    `.execute(trx);
    const other = waiting[0];
    if (other && other.steps > 0) {
      throw new HandoverRefused({ ok: false, reason: "other_company_handover", steps: other.steps, company: other.company_name });
    }
  }
  const empty = rows.find((r) => r.candidates.length === 0 || r.holder === null);
  if (empty) throw new HandoverRefused({ ok: false, reason: "nobody_can_take", step: empty.step_name, project: empty.project_name });

  const pickFor = new Map((picks ?? []).map((p) => [p.assignmentId, p.toMemberId]));
  const steps = rows.map((r) => ({ row: r, from: r.holder!.id, to: pickFor.get(r.assignment_id) }));
  // Every Step needs a pick from its candidates, a single one included: it is shown, pre-filled.
  if (steps.some(({ row, to }) => !row.candidates.some((c) => c.id === to))) {
    throw new HandoverRefused({ ok: false, reason: "handover_needed", handovers: rows.map(toStep) });
  }
  for (const { row, from, to } of steps) {
    const { rows: done } = await sql<{ outcome: string }>`
      select app.hand_over_step(${row.assignment_id}::uuid, ${from}::uuid, ${to!}::uuid, ${because}, ${now}) as outcome
    `.execute(trx);
    // Listed by app.handovers_needed just now, with that candidate: it can't be refused.
    checkedOutcome(done[0]!.outcome, ["handed_over"]);
  }
  return result;
}

function toStep(r: NeededRow): HandoverStep {
  return {
    assignmentId: r.assignment_id,
    project: { id: r.project_id, name: r.project_name },
    step: r.step_name,
    item: r.work_item_id === null ? null : { id: r.work_item_id, documentNumber: r.document_number, title: r.title ?? "" },
    holder: r.holder!,
    candidates: r.candidates,
  };
}
