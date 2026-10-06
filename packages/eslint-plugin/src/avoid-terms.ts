// Glossary Avoid terms (RP-327): the banned words are read from GLOSSARY.md, so a new _Avoid_ entry is checked without a code change.

export interface AvoidTerm {
  /** The term as the glossary writes it, e.g. "Work package". */
  term: string;
  /** Lower-case words, e.g. ["work", "package"]. */
  words: string[];
  /** Qualified "(on its own)": flagged only when it is the whole identifier or string. */
  bareOnly: boolean;
}

/** The lower-case words of an identifier, key or sentence: camelCase, snake_case and kebab-case parts, spaces. */
export const wordsOf = (text: string): string[] =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

export interface AvoidList {
  terms: AvoidTerm[];
  /** Phrases (as lower-case words) in which an Avoid word is fine: glossary terms, and the caller's exceptions. */
  exempt: string[][];
}

const singular = (words: string[]) => words.join(" ").replace(/s$/, "");

/**
 * The Avoid terms of a GLOSSARY.md: every `_Avoid_:` line, one term per comma.
 * - A term the glossary defines itself (a heading such as `**Comment**:`) is a current term elsewhere, so it is no Avoid term.
 * - A word inside a defined term is fine there: "list" in Option List, "activity" in Activity Feed.
 * - A term qualified "(on its own)" is bare-only; any other parenthetical is only an explanation.
 * `allowed` adds the caller's own exceptions: phrases, such as "user agent", or one word, such as "name".
 */
export function parseAvoidTerms(glossary: string, allowed: readonly string[] = []): AvoidList {
  const defined = [...glossary.matchAll(/^\*\*(.+?)\*\*:/gm)].map((match) => wordsOf(match[1]!));
  const definedKeys = new Set(defined.map(singular));
  const terms = new Map<string, AvoidTerm>();
  for (const line of glossary.matchAll(/^_Avoid_:\s*(.+)$/gm)) {
    // Commas inside parentheses stay with their term.
    for (const raw of line[1]!.split(/,(?![^(]*\))/)) {
      const term = raw.replace(/\(.*?\)/g, "").trim();
      const words = wordsOf(term);
      const key = words.join(" ");
      if (words.length === 0 || definedKeys.has(singular(words))) continue;
      const bareOnly = /on its own/i.test(raw);
      const known = terms.get(key);
      // The same word qualified in one entry and plain in another is plain.
      if (!known || (known.bareOnly && !bareOnly)) terms.set(key, { term, words, bareOnly });
    }
  }
  return { terms: [...terms.values()], exempt: [...defined, ...allowed.map(wordsOf)] };
}

const sameWord = (word: string, avoided: string) => word === avoided || word === `${avoided}s` || word === `${avoided}es`;

/** Where `phrase` occurs in `words`, as [start, end) pairs. */
function occurrences(words: string[], phrase: string[]): [number, number][] {
  const found: [number, number][] = [];
  for (let start = 0; start + phrase.length <= words.length; start++) {
    if (phrase.every((word, i) => sameWord(words[start + i]!, word))) found.push([start, start + phrase.length]);
  }
  return found;
}

/** The Avoid term found in an identifier, message key or string, if any. */
export function avoidTermIn(text: string, { terms, exempt }: AvoidList, kind: "name" | "text" = "text"): AvoidTerm | null {
  // ICU placeholders ("{company}") are not words.
  const words = wordsOf(text.replace(/{[^}]*}/g, " "));
  const exempted = exempt.flatMap((phrase) => occurrences(words, phrase));
  for (const avoid of terms) {
    // A bare-only term ("Template (on its own)") is a label problem: `template` as a name is fine, "Template" as text is not.
    // As text it is flagged only as a label: capitalised and nothing else ("Template"), not an id such as "lists".
    if (avoid.bareOnly && (kind === "name" || words.length !== avoid.words.length || !/^[A-Z]/.test(text.trim()))) continue;
    const hit = occurrences(words, avoid.words).find(([start, end]) => !exempted.some(([from, to]) => from <= start && end <= to));
    if (hit) return avoid;
  }
  return null;
}

// A plain word of copy: letters, maybe an apostrophe ("aren't"), maybe a bracket or punctuation around it.
const plainWord = /^\(?\p{L}+(?:['’]\p{L}+)*[.,:;!?)]*$/u;
// A code name quoted in copy: camelCase, snake_case, a dotted or slashed path, `a:b`, brackets, `=`, a tag, a placeholder.
const codeToken = /\p{Ll}\p{Lu}|_|\.\p{L}|\/|\p{L}:\p{L}|[[\]=<>{}]/u;
// SQL in a plain string starts with a statement keyword, in lower or upper case (never "Delete the…").
const sqlStatement = /^\s*(?:(?:select|insert|update|delete|with|create|alter|drop|grant|revoke|set)\s|(?:SELECT|INSERT|UPDATE|DELETE|WITH)\s)/;
// A Kysely column alias: "m.full_name as fullName".
const columnAlias = /^\s*[\w.]+ as \w+\s*$/;

/**
 * True when a string is copy people read: two plain words side by side ("Edit the title"), or a capitalised
 * word ("Status"). One token ("status", "work_item.title", "text-notes"), a Tailwind class list, SQL or a
 * column alias is code, checked as a name.
 */
export function readsAsCopy(text: string): boolean {
  if (sqlStatement.test(text) || columnAlias.test(text)) return false;
  if (/^\s*\p{Lu}\p{Ll}/u.test(text)) return true;
  const tokens = text.trim().split(/\s+/);
  return tokens.some((token, i) => plainWord.test(token) && plainWord.test(tokens[i + 1] ?? ""));
}

/**
 * The Avoid term in copy, if any. A code name quoted in it (`memberId`, `FILE_STORE_ENDPOINT`, a path) is
 * checked as a name; the words between code names are checked as text, each run on its own.
 */
export function avoidTermInCopy(text: string, inText: AvoidList, inNames: AvoidList): AvoidTerm | null {
  const runs: string[][] = [[]];
  for (const token of text.trim().split(/\s+/)) {
    if (!codeToken.test(token)) runs.at(-1)!.push(token);
    else {
      const hit = avoidTermIn(token, inNames, "name");
      if (hit) return hit;
      runs.push([]);
    }
  }
  // A lone run keeps the text as written, so a bare label ("Template") is still seen as one.
  if (runs.length === 1) return avoidTermIn(text, inText, "text");
  for (const run of runs) {
    const hit = run.length > 0 ? avoidTermIn(run.join(" "), inText, "text") : null;
    if (hit) return hit;
  }
  return null;
}
