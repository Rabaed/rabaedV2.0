import { resolve } from "node:path";
import { orderByEnd, splitComments } from "../packages/eslint-plugin/src/sql-sorts.ts";
import { hiddenColumns } from "./hidden-columns.ts";
import { migrationNames, migrationSql } from "./migrations.ts";

// A hidden column used as a sort key in a new migration (RP-534, from the RP-511
// retro): RP-108's app.handovers_needed ordered by `w.created_at`, a Draft's start
// time nobody may see. A hidden value stays out of the sort keys derived from it
// (CODING_STANDARDS §Visibility), so a migration this branch adds may not use a
// column of scripts/hidden-columns.ts inside an `order by` (a query's, a window's
// as in `row_number() over (… order by …)`, or an aggregate's) or a `distinct on`.
// Migrations already on main are not checked.
//
// Exception: a comment `-- hidden-sort-key: <reason>` on the line that uses the
// column or the line just above it (e.g. a worker-only function the app role
// can't call, or an order within one item's own rows that gives no time). The
// reason is required. It covers the uses on that line only: another hidden
// column on the next line of the same `order by` needs its own.
//
// Limits (pragmatic, not a SQL parser):
// - A column counts when it is qualified by its table or an alias the same
//   statement gives that table (`from work_item w`, `join app.work_item as w`;
//   no schema, `public.` or `app.`), or is
//   unqualified while the statement names the table. A statement runs from the
//   `;` before the sort clause to the `;` after it, so in a PL/pgSQL body a sort
//   clause sees only its own statement's aliases; a CTE in it is in scope.
// - Not followed: an output alias (`select w.created_at as t … order by t`), a
//   position (`order by 2`), a column reached through a view or another
//   function, or a value copied into a column the list doesn't name.
// - Comments are ignored, and only a real comment is an exception. A `'…'`
//   literal is skipped when looking for comments (`'--'` starts none), but its
//   contents stay in the code: dynamic SQL (`execute 'select … order by …'`) is
//   checked like any other. A `;` inside a literal still ends a statement.
//
// Run by `pnpm check:migrations` and by CI's "migration drift and timestamps"
// job, both through scripts/check-migration-drift.ts.
// Usage: node scripts/check-migrations-hidden-sort.ts <base> <head>

/** A hidden column used as a sort key: the migration, the line, the column and the visibility rule that hides it. */
export interface HiddenSortKey {
  file: string;
  line: number;
  column: string;
  rule: string;
}

const exceptionComment = /hidden-sort-key:\s*\S/;
const sortClauseStart = /\b(?<order>order\s+by)\b|\b(?<distinct>distinct\s+on)\s*\(/gi;
// Words that can follow a table name and are not its alias.
const notAlias = new Set([
  "where", "join", "inner", "left", "right", "full", "cross", "natural", "lateral", "on", "using", "order", "group", "having", "limit",
  "offset", "set", "union", "except", "intersect", "window", "returning", "for", "values", "select", "and", "or", "then", "loop", "into",
  "default", "fetch", "as", "with", "is", "in", "not", "from", "to", "add", "alter", "drop", "column", "enable", "disable", "owner",
]);

/** Where the `distinct on (` list starting at `start` (just after its `(`) ends. */
function parenEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "(") depth++;
    if (code[i] === ")" && depth-- === 0) return i;
  }
  return code.length;
}

/** The names a statement refers to `table` by: itself and each alias it gives it. Empty when it doesn't name the table. */
function namesFor(statement: string, table: string): Set<string> {
  const names = new Set<string>();
  const reference = new RegExp(`(?<![\\w."])(?:(?:public|app)\\.)?"?${table}"?(?![\\w"])(?:\\s+(?:as\\s+)?"?(\\w+)"?)?`, "gi");
  for (const match of statement.matchAll(reference)) {
    names.add(table);
    const alias = match[1]?.toLowerCase();
    if (alias && !notAlias.has(alias)) names.add(alias);
  }
  return names;
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** Each use of a hidden column as a sort key in a migration's SQL, by line, unless an exception comment covers it. */
export function hiddenSortKeys(file: string, sql: string): HiddenSortKey[] {
  const { code, comments } = splitComments(sql);
  const excepted = (line: number) => exceptionComment.test(comments.get(line) ?? "");
  const found = new Map<string, HiddenSortKey>();
  for (const clause of code.matchAll(sortClauseStart)) {
    const start = clause.index + clause[0].length;
    const end = clause.groups?.distinct ? parenEnd(code, start) : orderByEnd(code, start);
    const statement = code.slice(code.lastIndexOf(";", clause.index) + 1, code.indexOf(";", end) === -1 ? code.length : code.indexOf(";", end));
    for (const { table, columns, rule } of hiddenColumns) {
      const names = namesFor(statement, table);
      if (names.size === 0) continue;
      for (const hidden of columns) {
        const use = new RegExp(`(?<![\\w"])(?:"?(\\w+)"?\\.)?"?${hidden}"?(?![\\w"])`, "gi");
        for (const match of code.slice(start, end).matchAll(use)) {
          const qualifier = match[1]?.toLowerCase();
          if (qualifier && !names.has(qualifier)) continue;
          const line = lineAt(code, start + match.index);
          if (excepted(line) || excepted(line - 1)) continue;
          const column = `${table}.${hidden}`;
          found.set(`${line} ${column}`, { file, line, column, rule });
        }
      }
    }
  }
  return [...found.values()].toSorted((a, b) => a.line - b.line || (a.column < b.column ? -1 : 1));
}

/** The hidden sort keys in the migrations `head` adds to `base` (by name: those on `base` are not checked). */
export function branchHiddenSortKeys(repo: string, base: string, head: string): HiddenSortKey[] {
  const onBase = new Set(migrationNames(repo, base));
  return migrationNames(repo, head)
    .filter((name) => !onBase.has(name))
    .toSorted()
    .flatMap((name) => hiddenSortKeys(name, migrationSql(repo, head, name)));
}

/** Prints each hidden sort key the branch adds and returns them (RP-990: `check:migrations` counts them). */
export function reportHiddenSortKeys(repo: string, base: string, head: string): HiddenSortKey[] {
  const found = branchHiddenSortKeys(repo, base, head);
  for (const { file, line, column, rule } of found) {
    console.error(`${file}:${line} sorts by ${column}, which docs/visibility.md hides (${rule}).`);
    console.error("  A hidden value stays out of sort keys: sort by a value the viewer may see (e.g. the Submission Date, the Document Number, then the id). If nobody can learn the hidden value from this order, say why in a `-- hidden-sort-key: <reason>` comment on that line or the line above.");
  }
  if (found.length === 0) console.log("No new migration sorts by a hidden column (scripts/hidden-columns.ts).");
  return found;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("Usage: node scripts/check-migrations-hidden-sort.ts <base> <head>");
    process.exit(2);
  }
  if (reportHiddenSortKeys(process.cwd(), base, head).length > 0) process.exit(1);
}
