// How the Submittal Register Import matches a register's text to the Project's values
// (RP-639, spec RP-631 stories 8–10): a column heading to the field it fills, and a
// cell to a Type, Trade, Location, Scope or option. One definition, used by the api's
// preview, its Map values step and its suggestions.

/** A cell or heading as it is matched: lower case, with no spaces at all. "Fire Pump " and "firepump" are one. */
export function registerMatchKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** A value a cell may match: its id, and the texts that name it (code, English and Arabic names, a Location's path). */
export type RegisterCandidate = { id: string; names: readonly string[] };

/**
 * The one candidate `text` names, ignoring case and spaces, in either language; or the
 * value matched by hand for it in `manual` (by registerMatchKey), which wins. Null for
 * an empty cell, no match, or a text naming two different values (two Floors 1 in two
 * Buildings): that one is matched by hand.
 */
export function matchRegisterValue(
  text: string,
  candidates: readonly RegisterCandidate[],
  manual: Readonly<Record<string, string>> = {},
): string | null {
  const key = registerMatchKey(text);
  if (key === "") return null;
  const chosen = manual[key];
  if (chosen !== undefined) return candidates.some((c) => c.id === chosen) ? chosen : null;
  const ids = new Set(candidates.filter((c) => c.names.some((name) => registerMatchKey(name) === key)).map((c) => c.id));
  return ids.size === 1 ? [...ids][0]! : null;
}

/** The pieces of a cell holding several values (Scopes, a multiple choice): split at commas, semicolons and line breaks. */
export function splitRegisterValues(text: string): string[] {
  return text
    .split(/[,;،\n\r]+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
}

/** The pairs of letters of a key, for the similarity of two texts. */
function pairsOf(key: string): string[] {
  return Array.from({ length: Math.max(0, key.length - 1) }, (_, i) => key.slice(i, i + 2));
}

/**
 * How alike two texts are, from 0 to 100, ignoring case and spaces: 100 when equal; a
 * text inside the other ("Ref" in "TMC Ref", "Material" in "Material Approval Request")
 * at least 75; else the share of letter pairs they have in common.
 */
export function registerSimilarity(a: string, b: string): number {
  const x = registerMatchKey(a);
  const y = registerMatchKey(b);
  if (x === "" || y === "") return 0;
  if (x === y) return 100;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const inside = short.length >= 3 && long.includes(short) ? 75 + Math.round((25 * short.length) / long.length) - 1 : 0;
  const left = pairsOf(x);
  const right = pairsOf(y);
  let common = 0;
  const pool = [...right];
  for (const pair of left) {
    const at = pool.indexOf(pair);
    if (at !== -1) {
      common += 1;
      pool.splice(at, 1);
    }
  }
  const dice = left.length + right.length === 0 ? 0 : Math.round((200 * common) / (left.length + right.length));
  return Math.min(99, Math.max(inside, dice));
}

/** Below this, nothing is suggested. */
export const registerSuggestionFloor = 60;

/**
 * The candidate most like `text` (registerSimilarity against each of its names), when at
 * least registerSuggestionFloor alike: a suggestion the importer confirms on Map values,
 * never applied unseen.
 */
export function suggestRegisterValue(text: string, candidates: readonly RegisterCandidate[]): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    for (const name of candidate.names) {
      const score = registerSimilarity(text, name);
      if (score >= registerSuggestionFloor && (best === null || score > best.score)) best = { id: candidate.id, score };
    }
  }
  return best;
}

/** A field a column may fill, with the headings that name it, in English and Arabic. */
export type RegisterFieldTarget<F extends string = string> = { field: F; names: readonly string[] };

/**
 * A field for each column of the header row, from its heading: each field taken once,
 * the most alike pairs first; null where nothing is at least registerSuggestionFloor alike.
 */
export function suggestRegisterFields<F extends string>(
  headers: readonly string[],
  targets: readonly RegisterFieldTarget<F>[],
): ({ field: F; score: number } | null)[] {
  const pairs: { column: number; field: F; score: number }[] = [];
  headers.forEach((header, column) => {
    for (const target of targets) {
      const score = Math.max(0, ...target.names.map((name) => registerSimilarity(header, name)));
      if (score >= registerSuggestionFloor) pairs.push({ column, field: target.field, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.column - b.column);
  const out: ({ field: F; score: number } | null)[] = headers.map(() => null);
  const taken = new Set<F>();
  for (const pair of pairs) {
    if (out[pair.column] !== null || taken.has(pair.field)) continue;
    out[pair.column] = { field: pair.field, score: pair.score };
    taken.add(pair.field);
  }
  return out;
}
