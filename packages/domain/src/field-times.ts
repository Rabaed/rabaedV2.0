import { formatDate, type Locale } from "./locale.ts";

/**
 * Per-field times for autosave (form-engine.md §8, part 3). Each field of a
 * Work Item's answers records when it last changed and who changed it. A save
 * carries the times it was based on; a field another Member changed since is
 * kept as theirs, so of two editors the newer save of each field wins.
 */

/** When a field was last changed (ISO, millisecond precision), by which Member, and their name when the saver may see it. */
export type FieldStamp = { at: string; by: string | null; name: unknown };
export type FieldStamps = Readonly<Record<string, FieldStamp>>;

/** A field the save kept as another Member's, with their value as the saver may read it. */
export type KeptField = { field: string; at: string; by: string | null; name: unknown; value: unknown };

/** Equal by content: object key order doesn't matter. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The answers to store when `memberId` submits `submitted`, based on the times
 * `basedOn` (field key to the `at` they last saw), against what is `stored`.
 * A field is kept as stored when someone else changed it after `basedOn` and
 * the submitted value differs; a field with no time in `basedOn` counts as seen
 * before every change. Fields the saver left out are removed, as a save has
 * always replaced the answers, unless someone else changed them since.
 */
export function mergeFieldAnswers(input: {
  stored: Readonly<Record<string, unknown>>;
  stamps: FieldStamps;
  basedOn: Readonly<Record<string, string>>;
  submitted: Readonly<Record<string, unknown>>;
  memberId: string;
}): { merged: Record<string, unknown>; kept: KeptField[] } {
  const { stored, stamps, basedOn, submitted, memberId } = input;
  const merged: Record<string, unknown> = {};
  const kept: KeptField[] = [];
  const keys = new Set([...Object.keys(submitted), ...Object.keys(stored)]);
  for (const field of keys) {
    const stamp = stamps[field];
    const seen = basedOn[field];
    const changedByOther =
      stamp !== undefined &&
      stamp.by !== memberId &&
      (seen === undefined || Date.parse(stamp.at) > Date.parse(seen)) &&
      !sameValue(stored[field], submitted[field]);
    if (changedByOther) {
      if (field in stored) merged[field] = stored[field];
      kept.push({ field, at: stamp.at, by: stamp.by, name: stamp.name, value: stored[field] ?? null });
    } else if (field in submitted) {
      merged[field] = submitted[field];
    }
  }
  return { merged, kept };
}

/** "Saved 10:15" in Saudi time: the Save button's note on when the item was last saved. */
export function savedLabel(at: string, locale: Locale): string {
  const time = formatDate(new Date(at), locale, { timeStyle: "short" });
  return locale === "ar" ? `تم الحفظ ${time}` : `Saved ${time}`;
}

/** "Description changed by Omar just now": a field another Member changed, shown beside the Form. */
export function changedByLabel(fieldLabel: string, name: string, locale: Locale): string {
  return locale === "ar" ? `${fieldLabel}: غُيّر بواسطة ${name} قبل لحظات` : `${fieldLabel} changed by ${name} just now`;
}
