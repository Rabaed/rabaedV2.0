import { intlLocaleOf, type Locale } from "@rabaed/domain";

// A small ICU MessageFormat for the stories (RP-555), so they read the web app's own messages
// the way next-intl formats them: `{name}` arguments and `{count, plural, one {…} other {…}}`
// choices (exact `=n` cases, then the locale's plural rules), nested. Nothing else is needed.

type Values = Readonly<Record<string, string | number>>;

/** The index of the brace closing the one at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`Unclosed brace in ${text}`);
}

function plural(body: string, value: number, locale: Locale, values: Values): string {
  const cases = new Map<string, string>();
  for (let i = 0; i < body.length; ) {
    const open = body.indexOf("{", i);
    if (open < 0) break;
    const end = closing(body, open);
    cases.set(body.slice(i, open).trim(), body.slice(open + 1, end));
    i = end + 1;
  }
  const rule = new Intl.PluralRules(intlLocaleOf(locale)).select(value);
  const chosen = cases.get(`=${value}`) ?? cases.get(rule) ?? cases.get("other") ?? "";
  return formatIcu(chosen, values, locale);
}

/** `template` with its arguments filled in, in `locale`. */
export function formatIcu(template: string, values: Values, locale: Locale): string {
  let out = "";
  for (let i = 0; i < template.length; ) {
    const open = template.indexOf("{", i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const end = closing(template, open);
    const inner = template.slice(open + 1, end);
    const comma = inner.indexOf(",");
    if (comma < 0) out += String(values[inner.trim()] ?? "");
    else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const second = rest.indexOf(",");
      const kind = rest.slice(0, second).trim();
      if (kind !== "plural") throw new Error(`Unsupported ICU argument ${kind}`);
      out += plural(rest.slice(second + 1), Number(values[name] ?? 0), locale, values);
    }
    i = end + 1;
  }
  return out;
}

type Tree = { [key: string]: string | Tree };

/** A translator over one namespace of messages, as next-intl's `t` (a missing key reads as its path). */
export function translator(messages: Tree, locale: Locale): (key: string, values?: Values) => string {
  return (key, values = {}) => {
    let node: string | Tree | undefined = messages;
    for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
    return typeof node === "string" ? formatIcu(node, values, locale) : key;
  };
}
