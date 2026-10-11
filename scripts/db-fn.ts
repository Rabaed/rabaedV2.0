import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { functionChanges } from "./check-migration-drift.ts";
import { migrationsDir } from "./migrations.ts";

// `pnpm db:fn <name>` (RP-539): the newest definition of an `app.*` function.
// Migrations run in name order and the last `create or replace function` wins,
// so finding the current body meant grepping 100+ migrations and reading ranges
// of the wrong one (take_transition has 17 definitions).
//
// Usage: pnpm db:fn <name> [--list]     name with or without `app.`
//        --list prints every definition in order (file, line), not the bodies.
// Overloads (same name, other argument types) are each shown by their own newest definition.

export interface Definition {
  /** Migration file name. */
  file: string;
  /** 1-based line of `create function`. */
  line: number;
  /** Argument types, e.g. `uuid, text`; null for a drop without an argument list. */
  args: string | null;
  op: "create" | "drop";
  /** The whole statement, from `create` to its closing `;`. */
  text: string;
}

const blankComments = (sql: string) => sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** End offset of the statement starting at `start`: past its dollar-quoted body and the `;` after it. */
function statementEnd(code: string, start: number): number {
  const open = /\$(\w*)\$/g;
  open.lastIndex = start;
  const semicolon = code.indexOf(";", start);
  const quote = open.exec(code);
  if (!quote || (semicolon !== -1 && semicolon < quote.index)) return semicolon === -1 ? code.length : semicolon + 1;
  const close = code.indexOf(quote[0], quote.index + quote[0].length);
  if (close === -1) return code.length;
  const end = code.indexOf(";", close + quote[0].length);
  return end === -1 ? code.length : end + 1;
}

/** Every create or drop of `app.<name>` in one migration's SQL, in order. */
export function definitionsIn(file: string, sql: string, name: string): Definition[] {
  const code = blankComments(sql);
  const head = /\b(?<op>create(?:\s+or\s+replace)?|drop)\s+function\s+(?:if\s+exists\s+)?app\."?(?<name>\w+)"?\s*(?:\()?/gi;
  const matches = [...code.matchAll(head)].filter((m) => m.groups?.name?.toLowerCase() === name);
  // functionChanges reads the same statements, in the same order, for their argument types.
  const changes = functionChanges(sql).filter((c) => c.name === name);
  return matches.map((m, i) => ({
    file,
    line: code.slice(0, m.index).split("\n").length,
    args: changes[i]?.args ?? null,
    op: changes[i]?.op ?? "create",
    // The original text (comments kept) over the same offsets.
    text: sql.slice(m.index, statementEnd(code, m.index)),
  }));
}

/** The definitions of `app.<name>` across the migrations, in file order. */
export function findDefinitions(migrations: { name: string; sql: string }[], name: string): Definition[] {
  const wanted = name.replace(/^app\./i, "").toLowerCase();
  return migrations.toSorted((a, b) => (a.name < b.name ? -1 : 1)).flatMap((m) => definitionsIn(m.name, m.sql, wanted));
}

/** The newest definition of each signature that is still live: not dropped after its last create. */
export function currentDefinitions(definitions: Definition[]): Definition[] {
  const live = new Map<string, Definition>();
  for (const d of definitions) {
    if (d.op === "create") live.set(d.args ?? "", d);
    else if (d.args === null) live.clear();
    else live.delete(d.args);
  }
  return [...live.values()];
}

export function report(definitions: Definition[], name: string, list: boolean): { out: string; found: boolean } {
  const label = `app.${name.replace(/^app\./i, "")}`;
  if (definitions.length === 0) return { out: `Nothing in ${migrationsDir} defines ${label}.`, found: false };
  if (list) {
    const rows = definitions.map((d, i) => `${String(i + 1).padStart(3)}. ${migrationsDir}/${d.file}:${d.line}  ${d.op}${d.args === null ? "" : ` (${d.args})`}`);
    return { out: `${label} is defined ${definitions.length} time(s), oldest first:\n${rows.join("\n")}`, found: true };
  }
  const current = currentDefinitions(definitions);
  if (current.length === 0) {
    const last = definitions.at(-1)!;
    return { out: `${label} was dropped; the last statement is in ${migrationsDir}/${last.file}:${last.line}.`, found: true };
  }
  const out = current.map((d) => `-- ${migrationsDir}/${d.file}:${d.line}  (${label}(${d.args ?? ""}), definition ${definitions.indexOf(d) + 1} of ${definitions.length})\n${d.text}`);
  return { out: out.join("\n\n"), found: true };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const names = args.filter((a) => a !== "--list");
  if (names.length !== 1 || names[0]!.startsWith("-")) {
    console.error("Usage: pnpm db:fn <name> [--list]");
    process.exit(2);
  }
  const dir = resolve(import.meta.dirname, "..", migrationsDir);
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
  const { out, found } = report(findDefinitions(migrations, names[0]!), names[0]!, list);
  (found ? console.log : console.error)(out);
  if (!found) process.exit(1);
}
