import type { DocumentNumberSegments } from "@rabaed/domain";
import type { NumberPart } from "../numbering/numbering-model.ts";

export type SubmittalNumberSegment = DocumentNumberSegments["segments"][number];

/**
 * The "How this number is built" card (RP-1065, README §4.3): the number coloured part by part,
 * and one line per part. Null when the item read gives no segments (a Draft, or a number its
 * pattern doesn't rebuild): the ⓘ is then hidden.
 */
export function submittalNumberCard(
  segments: DocumentNumberSegments | undefined,
): { separator: string; parts: NumberPart[]; lines: SubmittalNumberSegment[] } | null {
  if (!segments) return null;
  return {
    separator: segments.separator,
    parts: segments.segments.map((s) => ({ kind: s.kind, text: s.value })),
    lines: segments.segments,
  };
}

/**
 * The name of what a Location part prints: the item's place at that level (1 = Zone), or its own
 * place when it sits above that level, as the number's builder takes it. `place` is the item's
 * Location path, top level first, and empty when the path isn't known: null then (the generic line),
 * never the item's own place standing in for another level.
 */
export function submittalNumberPlace(level: number, place: readonly string[]): string | null {
  return place[level - 1] ?? place.at(-1) ?? null;
}
