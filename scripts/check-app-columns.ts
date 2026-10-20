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

/** Words that may follow a call and then a parenthesis without being an alias. */
const notAliases = new Set(["and", "or", "not", "in", "any", "all", "some", "exists", "on", "using", "where", "when", "then", "else", "filter", "over", "within", "values", "select", "returning", "is", "like", "ilike", "between", "union", "except", "intersect"]);

const call = /\bapp\.(\w+)\s*\(/g;
/** After the call: `with ordinality`, `as`, an alias and its column list, each optional but the list. */
const aliasList = /^\s*(?:with\s+ordinality\s*)?(?:as\s*)?(?:([a-z_]\w*)\s*)?\(/i;

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
    const after = text.slice(closing(text, m.index + m[0].length - 1));
    const list = after.match(aliasList);
    if (!list) continue;
    const alias = list[1];
    if (alias !== undefined && notAliases.has(alias.toLowerCase())) continue;
    // `app.f(x) (` with neither alias nor `as` is not a FROM item.
    if (alias === undefined && !/^\s*(?:with\s+ordinality\s*)?as\b/i.test(after)) continue;
    found.push({ line: text.slice(0, m.index).split("\n").length, fn: `app.${m[1]}` });
  }
  return found;
}

/** The roots whose TypeScript is checked. */
const roots = ["apps", "packages"];

/** Every positional read in the TypeScript under `apps/*\/src` and `packages/*\/src` of `repo`. */
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
