import { z } from "zod";

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
    message: "countedBy names each of the pattern's segments at most once",
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

/** The pattern of a Project that has none: Project, Type, Participant Code, 4 digits, counted by all three. */
export const rabaedDefaultNumberingPattern: NumberingPattern = {
  segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }],
  separator: "-",
  seqDigits: 4,
  countedBy: [0, 1, 2],
};

/** What a Work Item's number is built from, when it first leaves Draft. */
export type NumberingAttributes = {
  projectCode: string;
  typeCode: string;
  /** Null without a Trade: the segment prints nothing. */
  tradeCode: string | null;
  /** The raiser's Participant: its Participant Code, null until set, and its position on the Project. */
  participant: { code: string | null; ordinal: number };
  /** The codes of the item's Location and its parents, from the Zone down; empty without a Location. */
  locationPath: readonly string[];
};

/** A saved pattern: in effect from `effectiveFrom`, and when its saver accepted the shared-counter warning. */
export const savedNumberingPattern = z.object({
  pattern: numberingPattern,
  effectiveFrom: z.iso.datetime(),
  sharedCounterAcceptedAt: z.iso.datetime().nullable(),
});
export type SavedNumberingPattern = z.infer<typeof savedNumberingPattern>;

/**
 * A Project's numbering, as every Project Member reads it on the Numbering page.
 * `project` null: the Rabaed Default. A Type whose `override` is null follows the
 * Project's pattern. `example`: what the live example is built from, the Project's
 * code, its first Trade and Location, and the reader's own Participant. Only
 * `canEdit` (a Project Admin) may save.
 */
export const numberingSettings = z.object({
  canEdit: z.boolean(),
  project: savedNumberingPattern.nullable(),
  types: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.object({ en: z.string(), ar: z.string() }),
      override: savedNumberingPattern.nullable(),
    }),
  ),
  example: z.object({
    projectCode: z.string(),
    tradeCode: z.string().nullable(),
    participant: z.object({ code: z.string().nullable(), ordinal: z.number().int() }),
    locationPath: z.array(z.string()),
  }),
});
export type NumberingSettings = z.infer<typeof numberingSettings>;

/** Zero-padded to `digits`, never cut. */
const padded = (value: number, digits: number) => String(value).padStart(digits, "0");

function segmentValue(segment: NumberingSegment, item: NumberingAttributes): string | null {
  switch (segment.kind) {
    case "project":
      return item.projectCode;
    case "type":
      return item.typeCode;
    case "trade":
      return item.tradeCode;
    case "participant":
      return item.participant.code ?? padded(item.participant.ordinal, 2);
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
    number: (seq: number) => prefix + pattern.separator + padded(seq, pattern.seqDigits),
  };
}
