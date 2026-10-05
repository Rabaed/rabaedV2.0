import { readCounterWorkItemTypes, readNumberingCounters, withMember, type Db } from "@rabaed/db";
import {
  counterStartRefusals,
  counterWorkItemTypes,
  numberingCounterRefusals,
  toNumberingCounter,
  type CounterPreview,
  type CounterStart,
  type CounterStartRequest,
  type CounterValues,
  type NumberingCounters,
} from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome } from "../outcomes.ts";

// Numbering counters and starting numbers (RP-315; workflow-engine.md §8
// "Starting numbers"). Counter values reveal a Company's volume: only a
// Project's Project Admins read them (row-level security on numbering_counter,
// and the checks in app.numbering_counter and app.set_numbering_counter_start).
// Anyone else gets 'not_found', exactly like a made-up Project (scenario 55).

type CounterRefusal = (typeof numberingCounterRefusals)[number];

export type CounterPreviewResult = { ok: true; preview: CounterPreview } | { ok: false; reason: CounterRefusal };
export type CounterStartResult = { ok: true; start: CounterStart } | { ok: false; reason: (typeof counterStartRefusals)[number] };

const isProjectAdmin = (trx: Db, projectId: string) =>
  sql`select 1 from app.current_admin_project_ids() x where x = ${projectId}::uuid`.execute(trx).then((r) => r.rows.length > 0);

/** A Project's counters and the Work Item Types to start one for, for its Project Admins; null for anyone else. */
export function listNumberingCounters(db: Db, memberId: string, projectId: string): Promise<NumberingCounters | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await isProjectAdmin(trx, projectId))) return null;
    return {
      counters: (await readNumberingCounters(trx, projectId)).map(toNumberingCounter),
      workItemTypes: counterWorkItemTypes(await readCounterWorkItemTypes(trx, projectId)),
    };
  });
}

/** The counter the values fall under, under the pattern in effect at `now`, for a Project Admin. */
export function previewNumberingCounter(
  db: Db,
  memberId: string,
  projectId: string,
  values: CounterValues,
  now: Date,
): Promise<CounterPreviewResult> {
  return withMember(db, memberId, async (trx): Promise<CounterPreviewResult> => {
    const { rows } = await sql<{
      outcome: string;
      counter_key: string;
      prefix: string;
      separator: string;
      seq_digits: number;
      last_value: number | null;
      issued: boolean;
    }>`
      select outcome, counter_key, prefix, separator, seq_digits, last_value, issued from app.numbering_counter(
        ${projectId}::uuid, ${values.workItemType}, ${values.participantId}::uuid, ${values.tradeId}::uuid,
        ${values.locationId}::uuid, ${now})
    `.execute(trx);
    const row = rows[0]!;
    const outcome = checkedOutcome(row.outcome, ["found", ...numberingCounterRefusals]);
    if (outcome !== "found") return { ok: false, reason: outcome };
    return {
      ok: true,
      preview: {
        counterKey: row.counter_key,
        prefix: row.prefix,
        separator: row.separator,
        seqDigits: row.seq_digits,
        lastValue: row.last_value,
        issued: row.issued,
      },
    };
  });
}

/** A Project Admin sets the starting number of the counter the values fall under, while it has issued nothing. */
export function setNumberingCounterStart(
  db: Db,
  memberId: string,
  projectId: string,
  input: CounterStartRequest,
  now: Date,
): Promise<CounterStartResult> {
  return withMember(db, memberId, async (trx): Promise<CounterStartResult> => {
    const { rows } = await sql<{ outcome: string; counter_key: string; next_number: string }>`
      select outcome, counter_key, next_number from app.set_numbering_counter_start(
        ${projectId}::uuid, ${input.workItemType}, ${input.participantId}::uuid, ${input.tradeId}::uuid,
        ${input.locationId}::uuid, ${input.startingNumber}::integer, ${now})
    `.execute(trx);
    const row = rows[0]!;
    const outcome = checkedOutcome(row.outcome, ["set", ...counterStartRefusals]);
    if (outcome !== "set") return { ok: false, reason: outcome };
    return { ok: true, start: { counterKey: row.counter_key, nextNumber: row.next_number } };
  });
}
