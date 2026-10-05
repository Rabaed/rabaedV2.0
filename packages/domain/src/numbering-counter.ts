import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import { sequencedNumber } from "./numbering.ts";

/**
 * Numbering counters and starting numbers (workflow-engine.md §8 "Starting
 * numbers"; data-model.md numbering_counter). A counter's values reveal a
 * Company's volume, so only Project Admins read them (visibility.md scenario 55).
 */

/** The largest starting number: a counter fits seven digits, the longest sequence a pattern has. */
export const maxStartingNumber = 9_999_999;

/** A Project's counter as its Project Admins see it. */
export const numberingCounter = z.object({
  /** The values of the pattern's counted segments, joined by `-` (e.g. `TWR-MAR-01`). */
  counterKey: z.string(),
  /** The last number it issued; one below its starting number while it has issued nothing. */
  lastValue: z.number().int(),
  /** Set when a Project Admin created it ahead; null when its first number created it. */
  startingNumber: z.number().int().nullable(),
  /** Whether it has issued a number: its starting number is then locked. */
  issued: z.boolean(),
});
export type NumberingCounter = z.infer<typeof numberingCounter>;

/** A Project's counters, and the Work Item Types a counter can be started for. */
export const numberingCounters = z.object({
  counters: z.array(numberingCounter),
  workItemTypes: z.array(z.object({ code: z.string(), name: bilingualText })),
});
export type NumberingCounters = z.infer<typeof numberingCounters>;

/**
 * The values that pick a counter under the pattern in effect: the Work Item
 * Type's code and, as the pattern counts by them, the raiser's Participant, a
 * Trade and a Location of the Project.
 */
export const counterValues = z.object({
  workItemType: z.string().min(1).max(6),
  participantId: z.uuid().nullable().default(null),
  tradeId: z.uuid().nullable().default(null),
  locationId: z.uuid().nullable().default(null),
});
export type CounterValues = z.infer<typeof counterValues>;

/** The counter some values fall under, for the Numbering page's example. */
export const counterPreview = z.object({
  counterKey: z.string(),
  /** The number before its sequence, under the pattern in effect. */
  prefix: z.string(),
  separator: z.string(),
  seqDigits: z.number().int(),
  /** Null while the counter doesn't exist yet. */
  lastValue: z.number().int().nullable(),
  issued: z.boolean(),
});
export type CounterPreview = z.infer<typeof counterPreview>;

/** A Project Admin sets the starting number of the counter the values fall under, while it has issued nothing. */
export const counterStartRequest = counterValues.extend({
  startingNumber: z.number().int().min(1).max(maxStartingNumber),
});
export type CounterStartRequest = z.infer<typeof counterStartRequest>;

/** The counter whose starting number was set, and the next number it issues. */
export const counterStart = z.object({ counterKey: z.string(), nextNumber: z.string() });
export type CounterStart = z.infer<typeof counterStart>;

/** The number a counter issues as `seq`: its prefix, the separator and `seq` zero-padded to the pattern's digits. */
export function counterNumber(preview: Pick<CounterPreview, "prefix" | "separator" | "seqDigits">, seq: number): string {
  return sequencedNumber(preview.prefix, preview.separator, preview.seqDigits, seq);
}

/** A numbering_counter row as the database stores it. */
export type StoredNumberingCounter = { counter_key: string; last_value: number; starting_value: number | null };

/**
 * A counter as Project Admins and Rabaed Engineers read it. It has issued a number
 * unless a starting number was set ahead and nothing has been issued since.
 */
export function toNumberingCounter(row: StoredNumberingCounter): NumberingCounter {
  return {
    counterKey: row.counter_key,
    lastValue: row.last_value,
    startingNumber: row.starting_value,
    issued: row.starting_value === null || row.last_value !== row.starting_value - 1,
  };
}

/**
 * The Work Item Types a counter can be started for, by code: the Rabaed Default
 * Types and the Project's own, `rows` ordered by code with a Project's own before
 * a Default of the same code, which it replaces.
 */
export function counterWorkItemTypes(rows: readonly { code: string; name: BilingualText }[]): NumberingCounters["workItemTypes"] {
  const byCode = new Map<string, BilingualText>();
  for (const t of rows) if (!byCode.has(t.code)) byCode.set(t.code, t.name);
  return [...byCode].map(([code, name]) => ({ code, name }));
}

/** The refusals of finding a counter for some values (app.numbering_counter, app.numbering_counter_for). */
export const numberingCounterRefusals = [
  "not_found",
  "type_not_found",
  "participant_required",
  "trade_required",
  "location_required",
  "value_not_found",
] as const;

/** The refusals of setting a starting number (app.set_numbering_counter_start, app.start_numbering_counter). */
export const counterStartRefusals = [...numberingCounterRefusals, "project_closed", "counter_used"] as const;
