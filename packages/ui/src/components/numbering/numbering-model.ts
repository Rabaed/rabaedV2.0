import {
  countsByParticipant,
  documentNumbering,
  segmentValue,
  type NumberingAttributes,
  type NumberingCounter,
  type NumberingPattern,
  type NumberingSegment,
} from "@rabaed/domain";
import type { SegmentTone } from "../../tokens/themes.ts";

// The Numbering page's pattern edits and numbers (RP-412), pure. The numbers come
// from @rabaed/domain's documentNumbering, the copy of the database's builder, so
// the page shows exactly what an item would get.

export type SegmentKind = NumberingSegment["kind"];

/** Every segment kind, in the order the "Add segment" buttons list them. */
export const segmentKinds: readonly SegmentKind[] = ["project", "participant", "trade", "type", "location", "text"];
export const maxSegments = 6;
export const digitChoices = [3, 4, 5, 6, 7] as const;
/** A number longer than this gets cut off in tables and exports. */
export const comfortableLength = 30;

/** The segments the scope chips offer: the ones whose values vary between items. */
export const scopedKinds: ReadonlySet<SegmentKind> = new Set<SegmentKind>(["participant", "trade", "type", "location"]);

/** The colour role of a segment kind (tokens `segment-<tone>-*`). */
export const segmentTone = (kind: SegmentKind | "sequence"): SegmentTone => kind;

/** A new segment of a kind: a Location at the Building level, fixed text SUB. */
export function newSegment(kind: SegmentKind): NumberingSegment {
  if (kind === "location") return { kind, level: 2 };
  if (kind === "text") return { kind, text: "SUB" };
  return { kind };
}

/** One coloured part of a number: a segment's value, or the sequence. */
export type NumberPart = { kind: SegmentKind | "sequence"; text: string };

/** A number under `pattern` for `item` with sequence `seq`, in parts (for the colours) and whole. */
export function patternNumber(pattern: NumberingPattern, item: NumberingAttributes, seq: number): { parts: NumberPart[]; text: string; counterKey: string } {
  const { number, counterKey } = documentNumbering(pattern, item);
  const parts: NumberPart[] = pattern.segments.flatMap((s) => {
    const text = segmentValue(s, item);
    return text === null ? [] : [{ kind: s.kind, text }];
  });
  parts.push({ kind: "sequence", text: String(seq).padStart(pattern.seqDigits, "0") });
  return { parts, text: number(seq), counterKey };
}

/**
 * The next sequence value each item gets. With the Project Admin's counters, the
 * real one: the counter's last number plus one (1 for a counter not started yet).
 * Without them, an example from 1: items counted together continue one sequence,
 * items counted apart each start at 1, so the scope's effect shows without any
 * real count (visibility.md scenario 55, RP-412-2).
 */
export function nextSequences(pattern: NumberingPattern, items: readonly NumberingAttributes[], counters?: readonly NumberingCounter[]): number[] {
  const examples = new Map<string, number>();
  return items.map((item) => {
    const key = documentNumbering(pattern, item).counterKey;
    if (counters) {
      const counter = counters.find((c) => c.counterKey === key);
      return counter ? counter.lastValue + 1 : 1;
    }
    const next = (examples.get(key) ?? 0) + 1;
    examples.set(key, next);
    return next;
  });
}

/** Adds a segment at the end. A Project or Company segment is counted separately, as in the Rabaed Default. */
export function addSegment(pattern: NumberingPattern, kind: SegmentKind): NumberingPattern {
  if (pattern.segments.length >= maxSegments) return pattern;
  const at = pattern.segments.length;
  const counted = kind === "project" || kind === "participant";
  return { ...pattern, segments: [...pattern.segments, newSegment(kind)], countedBy: counted ? [...pattern.countedBy, at] : pattern.countedBy };
}

/** Removes segment `i`, and its tick. */
export function removeSegment(pattern: NumberingPattern, i: number): NumberingPattern {
  if (pattern.segments.length <= 1) return pattern;
  return {
    ...pattern,
    segments: pattern.segments.filter((_, j) => j !== i),
    countedBy: pattern.countedBy.filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)),
  };
}

/** Moves segment `from` to position `to`, keeping each segment's tick with it. */
export function moveSegment(pattern: NumberingPattern, from: number, to: number): NumberingPattern {
  if (to < 0 || to >= pattern.segments.length || from === to) return pattern;
  const order = pattern.segments.map((_, j) => j);
  order.splice(to, 0, ...order.splice(from, 1));
  return {
    ...pattern,
    segments: order.map((j) => pattern.segments[j]!),
    countedBy: order.flatMap((j, at) => (pattern.countedBy.includes(j) ? [at] : [])).sort((a, b) => a - b),
  };
}

/** Replaces segment `i` (a Location's level, a fixed text). */
export function replaceSegment(pattern: NumberingPattern, i: number, segment: NumberingSegment): NumberingPattern {
  return { ...pattern, segments: pattern.segments.map((s, j) => (j === i ? segment : s)) };
}

/** Ticks or unticks every segment of a kind in the scope. */
export function setCounted(pattern: NumberingPattern, kind: SegmentKind, counted: boolean): NumberingPattern {
  const positions = pattern.segments.flatMap((s, i) => (s.kind === kind ? [i] : []));
  const rest = pattern.countedBy.filter((i) => !positions.includes(i));
  return { ...pattern, countedBy: (counted ? [...rest, ...positions] : rest).sort((a, b) => a - b) };
}

/** Whether the sequence counts separately for a kind. */
export const isCounted = (pattern: NumberingPattern, kind: SegmentKind) =>
  pattern.segments.some((s, i) => s.kind === kind && pattern.countedBy.includes(i));

/** The shared-counter warning applies: no Company segment, or one not counted separately. */
export const sharesCounter = (pattern: NumberingPattern) => !countsByParticipant(pattern);

/** Two patterns are the same. */
export const samePattern = (a: NumberingPattern | null, b: NumberingPattern | null) => JSON.stringify(a) === JSON.stringify(b);

/** A fixed text segment's text: capital letters and digits only, 1 to 10. */
export const cleanText = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
