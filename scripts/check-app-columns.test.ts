import { describe, expect, it } from "vitest";
import { positionalReads, repoPositionalReads } from "./check-app-columns.ts";

// RP-998: app.work_item_actions gained a 5th column (RP-658), and every read
// that named its columns by position had to change with it. A column added
// mid-list shifts every name after it, silently. Read app.* results by name.

describe("positionalReads", () => {
  it("refuses a column alias list on an app.* call, with ordinality or without", () => {
    const text = [
      "const a = sql`",
      "  from app.work_item_actions(${id}::uuid) with ordinality a (action, transition_key, n)",
      "  cross join lateral app.package_summary(k.id) as s (open, closed)",
      "  join app.reassign_candidates(w.id) c(id) on true",
      "`;",
    ].join("\n");
    expect(positionalReads(text)).toEqual([
      { line: 2, fn: "app.work_item_actions" },
      { line: 3, fn: "app.package_summary" },
      { line: 4, fn: "app.reassign_candidates" },
    ]);
  });

  it("refuses a column definition list, which names columns by position too", () => {
    expect(positionalReads("from app.rows(x) as (a int, b text)")).toEqual([{ line: 1, fn: "app.rows" }]);
  });

  it("follows the call's own parentheses, nested ones and an alias on the next line", () => {
    const text = "from app.work_item_actions(coalesce(${id}, (select 1)))\n  with ordinality\n  a (action, n)";
    expect(positionalReads(text)).toEqual([{ line: 1, fn: "app.work_item_actions" }]);
  });

  it("refuses a quoted alias, a comment before the list, and a second FROM item after a comma", () => {
    const text = [
      'from app.a(x) "q" (one, two)',
      "from app.b(x) -- why\n  b (one, two)",
      "from work_item w, app.c(w.id) c (one)",
    ].join("\n");
    expect(positionalReads(text)).toEqual([
      { line: 1, fn: "app.a" },
      { line: 2, fn: "app.b" },
      { line: 4, fn: "app.c" },
    ]);
  });

  it("passes what follows a FROM item without an alias list: a join, a limit, a subquery", () => {
    const text = [
      "from app.f(x) join (select 1) q on true",
      "from app.f(x) a left join (select 1) q on true",
      "from app.f(x) a limit (1)",
      "from app.f(x) a order by (a.ordinality)",
      "from app.f(x) as s\n  where (s.n > 1)",
      "cross join lateral app.f(w.id) seen\n  -- a comment (with parentheses)\n  cross join lateral (select 1) e",
    ].join("\n");
    expect(positionalReads(text)).toEqual([]);
  });

  it("passes TypeScript that is not SQL: a Fastify app's route and a cast", () => {
    expect(positionalReads("const r = app.get(url, handler) as (Route | null);\napp.post(\"/x\", h);")).toEqual([]);
  });

  it("passes reads by name: a bare alias, the ordinality column, a scalar call", () => {
    const text = [
      "from app.work_item_actions(w.id) with ordinality a",
      "join app.package_latest_items(k.id) l on l.work_item_id = w.id",
      "left join lateral app.package_summary(k.id) s on true",
      "where app.sees_work_item(w.id) and (x or y)",
      "select app.reassign_step(${id}::uuid) as outcome, app.need_my_action(w.id) in ('waiting')",
      "select outcome, package_id from app.create_package(${p}::uuid)",
      "// app.work_item_actions lists (prose)",
      "from unnest(${ids}::uuid[]) with ordinality as u (id, n)",
    ].join("\n");
    expect(positionalReads(text)).toEqual([]);
  });
});

describe("the repo", () => {
  it("reads no app.* result by position", () => {
    expect(repoPositionalReads()).toEqual([]);
  });
});
