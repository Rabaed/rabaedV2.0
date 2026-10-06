// The English and Arabic message files must hold the same keys, each a
// non-empty string with the same ICU arguments in both (RP-396). A key missing
// in one locale shows the raw key in that UI, and nobody notices until a person looks.

type Messages = { [key: string]: unknown };

/** Every gap between two locales' message files, one line per key; empty when they match. */
export function messageParityProblems(byLocale: Record<string, Messages>): string[] {
  const locales = Object.keys(byLocale);
  const leaves = new Map(locales.map((locale) => [locale, flatten(byLocale[locale]!)]));
  const paths = new Set(locales.flatMap((locale) => [...leaves.get(locale)!.keys()]));
  const problems: string[] = [];

  for (const path of [...paths].sort()) {
    const values = locales.map((locale) => ({ locale, value: leaves.get(locale)!.get(path) }));
    const missing = values.filter((v) => v.value === undefined).map((v) => v.locale);
    if (missing.length > 0) {
      problems.push(`${path}: missing in ${missing.join(", ")}`);
      continue;
    }
    const kinds = new Set(values.map((v) => kind(v.value)));
    if (kinds.size > 1) {
      problems.push(`${path}: ${values.map((v) => `${kind(v.value)} in ${v.locale}`).join(", ")}`);
      continue;
    }
    if (kinds.has("object")) continue;
    if (kinds.has("other")) {
      problems.push(`${path}: not a string or an object`);
      continue;
    }
    const empty = values.filter((v) => (v.value as string).trim() === "").map((v) => v.locale);
    if (empty.length > 0) {
      problems.push(`${path}: empty in ${empty.join(", ")}`);
      continue;
    }
    const args = values.map((v) => ({ locale: v.locale, args: [...messageArguments(v.value as string)].sort().join(", ") }));
    if (new Set(args.map((a) => a.args)).size > 1) {
      problems.push(`${path}: arguments differ (${args.map((a) => `${a.locale}: {${a.args}}`).join("; ")})`);
    }
  }
  return problems;
}

function kind(value: unknown): "string" | "object" | "other" {
  if (typeof value === "string") return "string";
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return "object";
  return "other";
}

/** Each key path to its value; an object with no keys is kept as a leaf so it still compares. */
function flatten(messages: Messages, prefix = "", into = new Map<string, unknown>()): Map<string, unknown> {
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    into.set(path, value);
    if (kind(value) === "object") flatten(value as Messages, path, into);
  }
  return into;
}

/**
 * The argument names in an ICU message: `{name}`, `{count, number}`, and those
 * inside a plural or select's options. Quoted text (`'{literal}'`) is skipped.
 */
export function messageArguments(message: string): Set<string> {
  const names = new Set<string>();
  let i = 0;

  // Message text up to an unmatched `}` (the end of a plural/select option) or the end.
  function text(): void {
    while (i < message.length && message[i] !== "}") {
      const ch = message[i]!;
      if (ch === "'") quoted();
      else if (ch === "{") argument();
      else i++;
    }
  }

  // `''` is one apostrophe; `'` before a brace quotes up to the next lone `'`.
  function quoted(): void {
    const next = message[i + 1];
    if (next === "'") {
      i += 2;
    } else if (next === "{" || next === "}" || next === "#" || next === "|") {
      i++;
      while (i < message.length) {
        if (message[i] === "'" && message[i + 1] === "'") i += 2;
        else if (message[i] === "'") break;
        else i++;
      }
      i++;
    } else {
      i++;
    }
  }

  function argument(): void {
    i++; // {
    const name = readUntil(",}");
    names.add(name);
    if (message[i] === "}") {
      i++;
      return;
    }
    i++; // ,
    const type = readUntil(",}");
    if (type === "plural" || type === "selectordinal" || type === "select") {
      if (message[i] === ",") i++;
      options();
    } else {
      skipToClose();
    }
  }

  // `one {…} other {…}` (with an optional `offset:n`) up to the argument's closing `}`.
  function options(): void {
    while (i < message.length && message[i] !== "}") {
      if (message[i] === "{") {
        i++;
        text();
        i++; // the option's }
      } else {
        i++;
      }
    }
    i++; // the argument's }
  }

  // A number/date style, which may itself hold braces (`::currency/SAR`, skeletons).
  function skipToClose(): void {
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
  }

  function readUntil(stops: string): string {
    const start = i;
    while (i < message.length && !stops.includes(message[i]!)) i++;
    return message.slice(start, i).trim();
  }

  while (i < message.length) {
    text();
    if (i < message.length) i++; // a stray `}` in top-level text
  }
  return names;
}
