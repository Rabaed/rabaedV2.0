import { stepAgeWeeks } from "@rabaed/domain";
import type { AgeCandidate } from "./index.ts";

// uat:age's changes (RP-922), pure: which item each --item names, and how far its times move so it
// reads Step Age N (scripts/uat-age.ts says how). No database here; scripts/uat-age.test.ts tests it.

const WEEK = 7 * 24 * 3_600_000;
const HOUR = 3_600_000;

export interface AgedItem {
  id: string;
  documentNumber: string;
  subject: string;
  /** How far back each of its times moves. */
  shiftMs: number;
  stepAge: { own: { from: number; to: number }; others: { from: number; to: number } };
}

export interface AgeChanges {
  items: AgedItem[];
}

const named = (c: AgeCandidate) => (c.documentNumber ? `${c.documentNumber} "${c.subject}"` : `"${c.subject}" (a Draft)`);
const fold = (text: string) => text.trim().toLowerCase();

/** The candidates `text` names: by Document Number, else by exact Subject; both any case. */
function matchesOf(text: string, candidates: AgeCandidate[]): AgeCandidate[] {
  const want = fold(text);
  const byNumber = candidates.filter((c) => c.documentNumber !== null && fold(c.documentNumber) === want);
  return byNumber.length > 0 ? byNumber : candidates.filter((c) => fold(c.subject) === want);
}

/**
 * The plan for `items` among `candidates` (the items whose Document Number or Subject contains one of
 * them): each text must name exactly one open, numbered item, younger than `weeks`. Every refusal
 * at once, and then no plan.
 */
export function ageChanges({ items, weeks }: { items: string[]; weeks: number }, candidates: AgeCandidate[], now: Date): AgeChanges | { errors: string[] } {
  const errors: string[] = [];
  const planned: AgedItem[] = [];
  const seen = new Set<string>();
  // Into its Nth week by an hour, so it reads Step Age N for the week after the run.
  const enteredBy = now.getTime() - (weeks - 1) * WEEK - HOUR;
  for (const text of items) {
    const matches = matchesOf(text, candidates);
    if (matches.length === 0) {
      const close = candidates.filter((c) => fold(c.subject).includes(fold(text)) || fold(c.documentNumber ?? "").includes(fold(text))).slice(0, 10);
      errors.push(`"${text.trim()}" matches no item by Document Number or exact Subject${close.length > 0 ? `. Close: ${close.map(named).join(", ")}` : ""}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`"${text.trim()}" matches ${matches.length} items; give one of their Document Numbers: ${matches.map(named).join(", ")}`);
      continue;
    }
    const c = matches[0]!;
    const label = c.documentNumber ?? `"${c.subject}"`;
    if (seen.has(c.id)) {
      errors.push(`${label} is named twice`);
      continue;
    }
    seen.add(c.id);
    if (c.documentNumber === null) {
      errors.push(`${label} is a Draft: a Draft has no Step Age (ADR 0020)`);
      continue;
    }
    if (c.closed) {
      errors.push(`${label} is closed: a closed item has no Step Age`);
      continue;
    }
    const shiftMs = c.stepEnteredAt.getTime() - enteredBy;
    const own = stepAgeWeeks(c.stepEnteredAt, now);
    if (shiftMs <= 0) {
      errors.push(`${label} already reads Step Age ${own}: the tool moves times back only, so give --weeks above ${own}`);
      continue;
    }
    const moved = (at: Date) => new Date(at.getTime() - shiftMs);
    planned.push({
      id: c.id,
      documentNumber: c.documentNumber,
      subject: c.subject,
      shiftMs,
      stepAge: {
        own: { from: own, to: stepAgeWeeks(moved(c.stepEnteredAt), now) },
        others: { from: stepAgeWeeks(c.participantEnteredAt, now), to: stepAgeWeeks(moved(c.participantEnteredAt), now) },
      },
    });
  }
  return errors.length > 0 ? { errors } : { items: planned };
}
