import { type UntiedSort, untiedSorts } from "../packages/eslint-plugin/src/sql-sorts.ts";
import { allDefinitions, currentDefinitions } from "./db-fn.ts";
import type { Migration } from "./migrations.ts";

// A sort that ends on a timestamp column (RP-1105). Two rows can share a time
// (every row one transaction writes gets the same now()), and the host's clock
// and the database's differ, so rows sorted by `at` alone came back in either
// order and failed tests at random. The current definition of every `app.*`
// function must end each `order by` (a query's, a window's or an aggregate's)
// on a unique column: `, x.id`, or a seq when the order rows were written in
// matters (ids are random, ADR 0015). How a sort is read, and the
// `-- sort-tiebreaker: <reason>` exception for a sort no two rows can tie in, are
// in packages/eslint-plugin/src/sql-sorts.ts, which the
// rabaed/order-by-tiebreaker lint rule uses for SQL in TypeScript too.
//
// Run by scripts/check-sort-tiebreakers.test.ts, in `pnpm test:unit` (so `pnpm verify` and CI).

/** The untied sorts in the current definition of every `app.*` function, by migration and line. */
export function currentUntiedSorts(migrations: Migration[]): (UntiedSort & { file: string; function: string })[] {
  return [...allDefinitions(migrations)]
    .flatMap(([name, definitions]) =>
      currentDefinitions(definitions).flatMap((d) =>
        untiedSorts(d.text).map((s) => ({ file: d.file, line: d.line + s.line - 1, function: `app.${name}`, key: s.key })),
      ),
    )
    .toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}
