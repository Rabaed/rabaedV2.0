import { orderByEnd, splitComments } from "./check-migrations-hidden-sort.ts";
import { allDefinitions, currentDefinitions } from "./db-fn.ts";

// A sort that ends on a timestamp column (RP-1105). Two rows can share a time
// (every row one transaction writes gets the same now()), and the host's clock
// and the database's differ, so rows sorted by `at` alone came back in either
// order and failed tests at random. The current definition of every `app.*`
// function must end each `order by` (a query's, a window's or an aggregate's)
// on a unique column: `, x.id`, or a seq when the order rows were written in
// matters (ids are random, ADR 0015). Kysely sorts in TypeScript are checked by
// the rabaed/order-by-tiebreaker lint rule.
//
// Exception: a comment `-- sort-tiebreaker: <reason>` on the line of the last
// key or the line above it, when no two rows can tie (a unique index). The
// reason is required.
//
// Limits (pragmatic, as in check-migrations-hidden-sort.ts): a key counts when
// it is a plain column (`at`, `created_at`, `l.updated_at`); an expression
// (`coalesce(…)`), a position or an output alias is not followed.
//
// Run by scripts/check-sort-tiebreakers.test.ts, in `pnpm test:unit` (so `pnpm verify` and CI).

export interface UntiedSort {
  /** 1-based line of the sort's last key. */
  line: number;
  /** The last key as written, e.g. `e.at`. */
  key: string;
}

const exceptionComment = /sort-tiebreaker:\s*\S/;
const sortStart = /\border\s+by\b/gi;
const timestampColumn = /^(?:"?\w+"?\.)?"?(?:at|\w+_at)"?$/i;
// What may follow a key's expression: a collation, a direction (or USING), NULLS FIRST/LAST.
const modifiers = /(?:\s+collate\s+(?:"[^"]*"|\w+))?(?:\s+(?:asc|desc|using\s+\S+))?(?:\s+nulls\s+(?:first|last))?$/i;

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** Offset of the last key of the sort list in code[start, end): after its last comma outside parentheses. */
function lastKeyStart(code: string, start: number, end: number): number {
  let depth = 0;
  let last = start;
  for (let i = start; i < end; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    else if (code[i] === "," && depth === 0) last = i + 1;
  }
  return last;
}

/** Each `order by` in the SQL whose last key is a timestamp column, unless an exception comment covers it. */
export function untiedSorts(sql: string): UntiedSort[] {
  const { code, comments } = splitComments(sql);
  const excepted = (line: number) => exceptionComment.test(comments.get(line) ?? "");
  const found: UntiedSort[] = [];
  for (const clause of code.matchAll(sortStart)) {
    const start = clause.index + clause[0].length;
    const end = orderByEnd(code, start);
    const from = lastKeyStart(code, start, end);
    const raw = code.slice(from, end);
    // A sort inside dynamic SQL ends at the literal's closing quote.
    const key = raw.trim().replace(/'+$/, "").replace(modifiers, "").trim();
    if (!timestampColumn.test(key)) continue;
    const line = lineAt(code, from + raw.indexOf(key));
    if (excepted(line) || excepted(line - 1)) continue;
    found.push({ line, key });
  }
  return found;
}

/** The untied sorts in the current definition of every `app.*` function, by migration and line. */
export function currentUntiedSorts(migrations: { name: string; sql: string }[]): (UntiedSort & { file: string; function: string })[] {
  return [...allDefinitions(migrations)]
    .flatMap(([name, definitions]) =>
      currentDefinitions(definitions).flatMap((d) =>
        untiedSorts(d.text).map((s) => ({ file: d.file, line: d.line + s.line - 1, function: `app.${name}`, key: s.key })),
      ),
    )
    .toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
