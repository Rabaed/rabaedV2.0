import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// An app.* function's result is read by its column names, never by position
// (RP-998). `app.f(x) a (one, two, n)` renames the function's columns in
// order: when the function gains a column mid-list (RP-658 added
// work_item_actions' 5th), every name after it reads its neighbour's value,
// with no error. Read `a.one`, and `a.ordinality` for `with ordinality`.
//
// Checked by scripts/check-app-columns.test.ts, in the unit project, over the
// TypeScript of every app and package (`apps/*/src`, `packages/*/src`).

export type PositionalRead = { line: number; fn: string };
export type FilePositionalRead = PositionalRead & { file: string };

/** Words that may follow a FROM item and then a parenthesis without being its alias. */
const notAliases = new Set([
  ...["and", "or", "not", "in", "any", "all", "some", "exists", "is", "like", "ilike", "between"],
  ...["join", "cross", "left", "right", "inner", "full", "natural", "lateral", "on", "using"],
  ...["where", "group", "having", "window", "order", "limit", "offset", "fetch", "for", "union", "except", "intersect", "returning"],
]);

/** An app.* call as a FROM item: after `from`, `join`, `lateral` or the comma between FROM items. */
const call = /(?:\bfrom|\bjoin|\blateral|,)\s+(app\.(\w+))\s*\(/gi;
/** Space, and any `--` comment in it, to the end of its line. */
const gap = String.raw`(?:\s|--[^\n]*(?:\n|$))*`;
/** After the call: `with ordinality`, `as`, an alias and its column list, each optional but the list. */
const aliasList = new RegExp(String.raw`^${gap}(?:with\s+ordinality\b${gap})?(as\b${gap})?(?:([a-z_]\w*|"[^"]+")${gap})?\(`, "i");

/** The index just past the parenthesis that closes the one at `open`; the text's length when none does. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Every app.* call in `text` whose result columns are named by a column alias or definition list. */
export function positionalReads(text: string): PositionalRead[] {
  const found: PositionalRead[] = [];
  for (const m of text.matchAll(call)) {
    const list = text.slice(closing(text, m.index + m[0].length - 1)).match(aliasList);
    if (!list) continue;
    const [, as, alias] = list;
    if (alias !== undefined && notAliases.has(alias.toLowerCase())) continue;
    // `app.f(x) (` with neither alias nor `as` lists no columns.
    if (alias === undefined && as === undefined) continue;
    const at = m.index + m[0].indexOf(m[1]!);
    found.push({ line: text.slice(0, at).split("\n").length, fn: `app.${m[2]}` });
  }
  return found;
}

/** The roots whose TypeScript is checked. */
const roots = ["apps", "packages"];

/** Every positional read in the TypeScript under each app's and package's `src` folder in `repo`. */
export function repoPositionalReads(repo: string = process.cwd()): FilePositionalRead[] {
  const found: FilePositionalRead[] = [];
  for (const root of roots) {
    for (const pkg of readdirSync(join(repo, root), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const src = join(repo, root, pkg.name, "src");
      let files: string[];
      try {
        files = readdirSync(src, { recursive: true, encoding: "utf8" });
      } catch {
        continue;
      }
      for (const file of files.filter((f) => /\.tsx?$/.test(f) && !f.includes("node_modules"))) {
        const path = `${root}/${pkg.name}/src/${file.replace(/\\/g, "/")}`;
        for (const read of positionalReads(readFileSync(join(src, file), "utf8"))) found.push({ file: path, ...read });
      }
    }
  }
  return found;
}
