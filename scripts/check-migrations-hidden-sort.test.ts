import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchHiddenSortKeys, hiddenSortKeys } from "./check-migrations-hidden-sort.ts";
import { migrationsDir as dir } from "./migrations.ts";

describe("branchHiddenSortKeys", () => {
  // A throwaway repository: `main` with a migration that already sorts by a Draft's start time, then a branch off it.
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo });
  const sorted = "select w.id from work_item w\norder by w.created_at;\n";
  function commit(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "change");
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-hidden-sort-repo-"));
    git("init", "-q", "-b", "main");
    commit({ [`${dir}/20260928150000_old.sql`]: sorted });
    git("switch", "-q", "-c", "change");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("reports only the migrations the branch adds, not those already on main", () => {
    commit({ [`${dir}/20270420000000_new.sql`]: sorted, [`${dir}/20270420000001_fine.sql`]: "select w.id from work_item w order by w.id;\n" });
    expect(branchHiddenSortKeys(repo, "main", "HEAD")).toEqual([{ file: "20270420000000_new.sql", line: 2, column: "work_item.created_at", rule: expect.any(String) }]);
  });

  it("passes a branch that adds no such migration", () => {
    commit({ "README.md": "x" });
    expect(branchHiddenSortKeys(repo, "main", "HEAD")).toEqual([]);
  });
});

const name = "20270420000000_handovers.sql";

describe("hiddenSortKeys", () => {
  it("reports a Draft's created_at, through an alias, in an app function's order by, with file and line", () => {
    const sql = [
      "create or replace function app.handovers_needed()",
      "  returns setof uuid language sql stable as $$",
      "    select w.id from work_item w",
      "    where w.document_number is not null",
      "    order by w.created_at desc, w.id",
      "$$;",
    ].join("\n");
    expect(hiddenSortKeys(name, sql)).toEqual([{ file: name, line: 5, column: "work_item.created_at", rule: expect.stringContaining("Creation Date") }]);
  });

  it("is silenced by an exception comment with a reason, on the line or the line above", () => {
    const above = ["select w.id from work_item w", "-- hidden-sort-key: worker-only, the app role can't call it", "order by w.created_at;"].join("\n");
    const same = "select w.id from work_item w order by w.created_at; -- hidden-sort-key: worker-only";
    expect(hiddenSortKeys(name, above)).toEqual([]);
    expect(hiddenSortKeys(name, same)).toEqual([]);
  });

  it("is not silenced by an exception comment without a reason, or far from the sort key", () => {
    const bare = ["select w.id from work_item w", "-- hidden-sort-key:", "order by w.created_at;"].join("\n");
    const far = ["-- hidden-sort-key: worker-only", "select w.id from work_item w", "where true", "order by w.id,", "  w.created_at;"].join("\n");
    expect(hiddenSortKeys(name, bare).map((k) => k.line)).toEqual([3]);
    expect(hiddenSortKeys(name, far).map((k) => k.line)).toEqual([5]);
  });

  it("reports a window's and a distinct on's sort keys", () => {
    const sql = [
      "select row_number() over (partition by w.project_id order by w.created_at) from work_item w;",
      "select distinct on (a.work_item_id, a.since) a.work_item_id from work_item_access a order by a.work_item_id;",
    ].join("\n");
    expect(hiddenSortKeys(name, sql).map((k) => `${k.line} ${k.column}`)).toEqual(["1 work_item.created_at", "2 work_item_access.since"]);
  });

  it("reports an unqualified hidden column when the statement names its table", () => {
    expect(hiddenSortKeys(name, "select id from work_item order by created_at;").map((k) => k.column)).toEqual(["work_item.created_at"]);
  });

  it("leaves alone a same-named column of another table, a hidden column outside sort keys, and a sort key in a comment", () => {
    const sql = [
      "select w.created_at > now() from work_item w join work_item_event e on e.work_item_id = w.id",
      "where w.created_at is not null",
      "order by e.created_at, w.submitted_at; -- order by w.created_at",
      "select id from work_item_event order by created_at;",
      "/* select w.id from work_item w order by w.created_at; */",
    ].join("\n");
    expect(hiddenSortKeys(name, sql)).toEqual([]);
  });

  it("scopes an alias to its statement: w is a work_item in one and an event in the next", () => {
    const sql = ["select w.id from work_item w order by w.id;", "select w.id from work_item_event w order by w.created_at;"].join("\n");
    expect(hiddenSortKeys(name, sql)).toEqual([]);
  });
});
