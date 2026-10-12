// Comparing JSON documents by content alone (RP-437 review): the one order every key and
// key-like string is sorted in, and a document's canonical form, whatever the order of
// its objects' keys.

/** `a` before `b` by UTF-16 code units, as `Array.prototype.sort` without a comparator, never by locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `value` as JSON with every object's keys in order, so two documents compare by content alone. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => compareStrings(a, b)))
      : v,
  );
}

/** Whether `a` and `b` are the same JSON document, whatever the order of their keys. */
export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
