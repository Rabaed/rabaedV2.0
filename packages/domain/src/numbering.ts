import { z } from "zod";
import { bilingualText } from "./company.ts";

/**
 * Numbering Patterns (GLOSSARY.md; workflow-engine.md §8, "Settled 2026-10-05
 * (Document numbering)"; data-model.md numbering_pattern). The one home of how a
 * Document Number is built, for the web's live example. The database builds the
 * number it issues the same way (`app.document_numbering`), inside the Transition
 * that first takes a Work Item out of Draft.
 */

/** One segment of a Numbering Pattern. A Location segment prints the item's Location at that level (1 = Zone). */
export const numberingSegment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }),
  z.object({ kind: z.literal("type") }),
  z.object({ kind: z.literal("trade") }),
  z.object({ kind: z.literal("participant") }),
  z.object({ kind: z.literal("location"), level: z.number().int().min(1).max(3) }),
  z.object({ kind: z.literal("text"), text: z.string().regex(/^[A-Z0-9]{1,10}$/) }),
]);
export type NumberingSegment = z.infer<typeof numberingSegment>;

export const numberingSeparators = ["-", "/"] as const;

/**
 * A Numbering Pattern: up to 6 segments, a separator, a sequence of 3–7 digits,
 * and `countedBy`, the positions (from 0) of the segments the sequence counts
 * separately for.
 */
export const numberingPattern = z
  .object({
    segments: z.array(numberingSegment).min(1).max(6),
    separator: z.enum(numberingSeparators),
    seqDigits: z.number().int().min(3).max(7),
    countedBy: z.array(z.number().int().min(0).max(5)),
  })
  .refine((p) => p.countedBy.every((i) => i < p.segments.length) && new Set(p.countedBy).size === p.countedBy.length, {
    message: "countedBy lists each of the pattern's segments at most once",
    path: ["countedBy"],
  });
export type NumberingPattern = z.infer<typeof numberingPattern>;

/**
 * Whether the sequence counts separately for the Participant Code, so each
 * Company's numbers run without gaps from the others' (visibility.md, Document
 * Numbers). Saving a pattern that doesn't needs the shared-counter warning accepted.
 */
export function countsByParticipant(pattern: NumberingPattern): boolean {
  return pattern.countedBy.some((i) => pattern.segments[i]?.kind === "participant");
}

/**
 * A Project Admin saves the Project's pattern (`workItemTypeId` null) or a Work
 * Item Type's override. `sharedCounterAccepted`: the saver accepts that, when the
 * sequence doesn't count by the Participant Code, every Company can tell the
 * others' volume from the gaps; required then, and recorded with who and when.
 */
export const saveNumberingPatternRequest = z.object({
  workItemTypeId: z.uuid().nullable(),
  pattern: numberingPattern,
  sharedCounterAccepted: z.boolean().default(false),
});
export type SaveNumberingPatternRequest = z.infer<typeof saveNumberingPatternRequest>;

/**
 * The Numbering page's save: as `saveNumberingPatternRequest`, except that a Work
 * Item Type's `pattern` may be null, "use the Project pattern" from now (its Custom
 * pattern stays as a version). The Project's own pattern can't be null ('invalid_pattern').
 */
export const saveNumberingRequest = saveNumberingPatternRequest.extend({ pattern: numberingPattern.nullable() });
export type SaveNumberingRequest = z.infer<typeof saveNumberingRequest>;

/** The pattern of a Project that has none: Project, Type, Participant Code, 4 digits, counted by all three. */
export const rabaedDefaultNumberingPattern: NumberingPattern = {
  segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }],
  separator: "-",
  seqDigits: 4,
  countedBy: [0, 1, 2],
};

/** What a Work Item's number is built from, when it first leaves Draft. */
export const numberingAttributes = z.object({
  projectCode: z.string(),
  typeCode: z.string(),
  /** Null without a Trade: the segment prints nothing. */
  tradeCode: z.string().nullable(),
  /**
   * The raiser's Participant: its Participant Code, null until set, and its position
   * on the Project. The position is null where the reader may not know it (anyone
   * but a Project Admin, visibility.md RP-381-1): an example then prints
   * `participantPlaceholder`. An issued number always has it.
   */
  participant: z.object({ code: z.string().nullable(), ordinal: z.number().int().nullable() }),
  /** The codes of the item's Location and its parents, from the Zone down; empty without a Location. */
  locationPath: z.array(z.string()),
});
export type NumberingAttributes = z.infer<typeof numberingAttributes>;

/** A saved pattern: in effect from `effectiveFrom`, and when its saver accepted the shared-counter warning. */
export const savedNumberingPattern = z.object({
  pattern: numberingPattern,
  effectiveFrom: z.iso.datetime(),
  sharedCounterAcceptedAt: z.iso.datetime().nullable(),
});
export type SavedNumberingPattern = z.infer<typeof savedNumberingPattern>;

/** A Work Item Type the Project can number, with its override (null: it follows the Project's pattern). */
export const numberingTypeOverride = z.object({
  id: z.uuid(),
  code: z.string(),
  name: bilingualText,
  override: savedNumberingPattern.nullable(),
});
export type NumberingTypeOverride = z.infer<typeof numberingTypeOverride>;

/**
 * A numbering_pattern row as the database stores it: `seq_scope` is the pattern's
 * `countedBy`. A Type's row that `follows_project` has no pattern: the Type uses the
 * Project's again from then.
 */
export type StoredNumberingPattern = {
  work_item_type_id: string | null;
  follows_project: boolean;
  segments: unknown;
  separator: string | null;
  seq_digits: number | null;
  seq_scope: unknown;
  effective_from: Date;
  shared_counter_accepted_at: Date | null;
};

type StoredPatternColumns = Pick<StoredNumberingPattern, "segments" | "separator" | "seq_digits" | "seq_scope">;
const storedPattern = (row: StoredPatternColumns): NumberingPattern =>
  numberingPattern.parse({ segments: row.segments, separator: row.separator, seqDigits: row.seq_digits, countedBy: row.seq_scope });

/** A stored pattern as the API returns it; null for a Type's row that follows the Project's. */
export function toSavedNumberingPattern(row: StoredNumberingPattern): SavedNumberingPattern | null {
  if (row.follows_project) return null;
  return {
    pattern: storedPattern(row),
    effectiveFrom: row.effective_from.toISOString(),
    sharedCounterAcceptedAt: row.shared_counter_accepted_at?.toISOString() ?? null,
  };
}

/**
 * One version of the Project's pattern (`workItemTypeId` null) or of a Type's
 * Custom pattern, numbered from 1 in the order they took effect. `pattern` null:
 * from then the Type uses the Project pattern. `savedBy`: a Rabaed Engineer, or the
 * saving Project Admin's Company by name where the reader may know it (null
 * otherwise, V15), and the Project Admin's name only within the reader's own
 * Company (V14). visibility.md RP-412-1, RP-412-3.
 */
export const numberingVersion = z.object({
  workItemTypeId: z.uuid().nullable(),
  version: z.number().int().min(1),
  effectiveFrom: z.iso.datetime(),
  pattern: numberingPattern.nullable(),
  savedBy: z.object({ rabaed: z.boolean(), company: bilingualText.nullable(), member: bilingualText.nullable() }),
});
export type NumberingVersion = z.infer<typeof numberingVersion>;

/** A row of app.numbering_pattern_versions. */
export type StoredNumberingVersion = StoredPatternColumns & {
  work_item_type_id: string | null;
  follows_project: boolean;
  effective_from: Date;
  version_no: number;
  by_rabaed: boolean;
  company_name: z.infer<typeof bilingualText> | null;
  member_name: z.infer<typeof bilingualText> | null;
};

/** A version as the API returns it. */
export function toNumberingVersion(row: StoredNumberingVersion): NumberingVersion {
  return {
    workItemTypeId: row.work_item_type_id,
    version: row.version_no,
    effectiveFrom: row.effective_from.toISOString(),
    pattern: row.follows_project ? null : storedPattern(row),
    savedBy: { rabaed: row.by_rabaed, company: row.company_name, member: row.member_name },
  };
}

/**
 * The Project's pattern and each Type's override from the patterns in effect
 * (one row per scope, `work_item_type_id` null for the Project's).
 */
export function numberingPatternsInEffect(
  patterns: readonly StoredNumberingPattern[],
  types: readonly { id: string; code: string; name: z.infer<typeof bilingualText> }[],
): { project: SavedNumberingPattern | null; types: NumberingTypeOverride[] } {
  const of = (typeId: string | null) => {
    const row = patterns.find((p) => p.work_item_type_id === typeId);
    return row ? toSavedNumberingPattern(row) : null;
  };
  return { project: of(null), types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, override: of(t.id) })) };
}

/** The refusals of saving a pattern (app.set_numbering_pattern, app.apply_numbering_pattern). */
export const numberingPatternRefusals = ["not_found", "project_closed", "type_not_found", "invalid_pattern", "shared_counter_not_accepted"] as const;

/**
 * A Project's numbering, as every Project Member reads it on the Numbering page.
 * `project` null: the Rabaed Default. A Type whose `override` is null follows the
 * Project's pattern. `example`: what the live example is built from, the Project's
 * code, its first Trade and Location, and the reader's own Participant (its order on
 * the Project for a Project Admin only, RP-381-1). Only
 * `canEdit` (a Project Admin) may save. Never a counter's value: only Project Admins
 * read those, from the counters (visibility.md scenario 55, RP-412-2).
 */
export const numberingSettings = z.object({
  canEdit: z.boolean(),
  project: savedNumberingPattern.nullable(),
  types: z.array(numberingTypeOverride),
  example: numberingAttributes.omit({ typeCode: true }),
  /** Every version of the Project's pattern and of each Type's Custom pattern, newest first. */
  versions: z.array(numberingVersion),
});
export type NumberingSettings = z.infer<typeof numberingSettings>;

/** Zero-padded to `digits`, never cut. */
const padded = (value: number, digits: number) => String(value).padStart(digits, "0");

/**
 * A number from its prefix and its sequence value: the separator, then the value
 * zero-padded to the pattern's digits, never cut (`app.sequenced_document_number`).
 */
export function sequencedNumber(prefix: string, separator: string, seqDigits: number, seq: number): string {
  return prefix + separator + padded(seq, seqDigits);
}

/** What an example prints for a Participant without a code whose order on the Project the reader may not know (RP-381-1). */
export const participantPlaceholder = "XX";

/**
 * What the Participant segment prints: the Participant Code, or the Participant's
 * order on the Project (01) until one is set; `participantPlaceholder` when the
 * order is withheld from the reader, never a number.
 */
export function participantSegment(participant: { code: string | null; ordinal: number | null }): string {
  return participant.code ?? (participant.ordinal === null ? participantPlaceholder : padded(participant.ordinal, 2));
}

/** What one segment prints for an item; null when the item has no such value (an item without a Trade). */
export function segmentValue(segment: NumberingSegment, item: NumberingAttributes): string | null {
  switch (segment.kind) {
    case "project":
      return item.projectCode;
    case "type":
      return item.typeCode;
    case "trade":
      return item.tradeCode;
    case "participant":
      return participantSegment(item.participant);
    case "location":
      // An item whose Location sits above the level prints its own Location's code.
      return item.locationPath[segment.level - 1] ?? item.locationPath.at(-1) ?? null;
    case "text":
      return segment.text;
  }
}

/**
 * A Work Item's numbering under a pattern: the key of the counter its sequence
 * comes from (the counted segments' values, joined by `-`), and its number for a
 * sequence value.
 */
export function documentNumbering(pattern: NumberingPattern, item: NumberingAttributes) {
  const values = pattern.segments.map((s) => segmentValue(s, item));
  const present = (v: string | null): v is string => v !== null;
  const prefix = values.filter(present).join(pattern.separator);
  const counterKey = values.filter((v, i) => pattern.countedBy.includes(i)).filter(present).join("-");
  return {
    counterKey,
    number: (seq: number) => sequencedNumber(prefix, pattern.separator, pattern.seqDigits, seq),
  };
}
