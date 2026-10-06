// The Dashboard's bucket and Code C rules have one definition per layer (CODING_STANDARDS.md
// › Tests): chainBucket / codeCState in @rabaed/domain, and the SQL the work item query
// builds from the same rule lists (bucketOfRow, codeCOfRow, chainConditionSql), with
// `closed` from closedStageCategory. Here the SQL runs over every combination of what the
// rules read, as literal rows, and must give what the domain gives for each: so cancelled,
// Inspection Results, outcome kind `none`, Sent Back (open and Submitted) and the fallbacks
// are all covered, the domain tests' own cases among them.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  chainBucket,
  codeCConditionKeys,
  codeCState,
  holdsCodeCCondition,
  isOpenStageCategory,
  outcomeKinds,
  stageCategories,
  workItemOutcomes,
  type ChainBucket,
  type CodeCCondition,
  type CodeCInput,
  type CodeCState,
} from "@rabaed/domain";
import { sql, type RawBuilder } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { bucketOfRow, chainConditionSql, closedStageCategory, codeCOfRow } from "../src/work-items/query.ts";

const db = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => db.destroy());

const booleans = [true, false] as const;

/** Every input the rules read. */
const grid: CodeCInput[] = outcomeKinds.flatMap((outcomeKind) =>
  stageCategories.flatMap((stageCategory) =>
    [null, ...workItemOutcomes].flatMap((outcome) =>
      booleans.flatMap((submitted) =>
        booleans.flatMap((raisedByViewer) => booleans.map((hadCodeC) => ({ outcomeKind, stageCategory, outcome, submitted, raisedByViewer, hadCodeC }))),
      ),
    ),
  ),
);

/** `select`ed over the grid as rows shaped like the work item query's (as `r`), in grid order. */
async function overGrid<T>(select: RawBuilder<T>): Promise<T[]> {
  const values = sql.join(
    grid.map(
      (g, i) =>
        sql`(${i}::integer, ${g.outcomeKind}::text, ${g.stageCategory}::text, ${g.outcome}::text, ${g.submitted}::boolean, ${g.raisedByViewer}::boolean, ${g.hadCodeC}::boolean)`,
    ),
  );
  const { rows } = await sql<{ value: T }>`
    select ${select} as value
    from (
      select v.*, ${closedStageCategory(sql.ref("v.stage_category"))} as closed
      from (values ${values}) as v (i, outcome_kind, stage_category, outcome, submitted, raised_by_own, had_code_c)
    ) r
    order by r.i
  `.execute(db);
  return rows.map((r) => r.value);
}

const show = (g: CodeCInput) => JSON.stringify(g);

describe("the work item query's SQL for the Dashboard's rules", () => {
  it("has `closed` exactly where isOpenStageCategory says a Stage category is not open", async () => {
    const closed = await overGrid(sql<boolean>`r.closed`);
    grid.forEach((g, i) => expect(closed[i], g.stageCategory).toBe(!isOpenStageCategory(g.stageCategory)));
  });

  it("gives every chain the bucket chainBucket gives it", async () => {
    const buckets = await overGrid<ChainBucket | null>(bucketOfRow);
    grid.forEach((g, i) => expect(buckets[i], show(g)).toBe(chainBucket(g)));
  });

  it("gives every chain the Code C state codeCState gives it", async () => {
    const states = await overGrid<CodeCState | null>(codeCOfRow);
    grid.forEach((g, i) => expect(states[i], show(g)).toBe(codeCState(g)));
  });

  it("handles every condition key the domain does, each value of it alone holding where the domain's does", async () => {
    // Each key's values; a Record, so a new key must be listed here, and so must its SQL.
    const valuesOf: { [K in keyof CodeCCondition]-?: readonly NonNullable<CodeCCondition[K]>[] } = {
      open: booleans,
      submitted: booleans,
      raisedByViewer: booleans,
      outcomeKind: outcomeKinds,
      outcome: workItemOutcomes,
      stageCategory: stageCategories,
      hadCodeC: booleans,
    };
    expect(Object.keys(valuesOf).toSorted()).toEqual([...codeCConditionKeys].toSorted());
    for (const key of codeCConditionKeys) {
      for (const value of valuesOf[key]) {
        const when = { [key]: value } as CodeCCondition;
        const held = await overGrid(chainConditionSql(when));
        const expected = grid.map((g) => holdsCodeCCondition(when, g));
        expect(held, JSON.stringify(when)).toEqual(expected);
        expect(expected.some((h) => !h), `${JSON.stringify(when)} rules no chain out`).toBe(true);
      }
    }
    expect(() => chainConditionSql({ late: true } as CodeCCondition)).toThrow(/late/);
  });
});
