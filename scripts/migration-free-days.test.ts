import { describe, expect, it } from "vitest";
import { freeDay, type FreeDaySeam } from "./migration-free-days.ts";

const table = `| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
`;

const related = () => true;

// A fake seam: main's and two branches' migrations, the worktree's, and both reservation files.
function fakeSeam(overrides: Partial<FreeDaySeam> = {}): FreeDaySeam {
  return {
    remoteBranches: () => [
      { name: "main", migrations: ["20270326000000_sent_back_built_ins.sql"], sharesHistory: related },
      { name: "RP-583-new", migrations: ["20270326000000_sent_back_built_ins.sql", "20270327000000_review_fixes.sql"], sharesHistory: related },
    ],
    localMigrations: () => ["20270326000000_sent_back_built_ins.sql"],
    reservations: () => [table, table],
    today: () => "20261015",
    ...overrides,
  };
}

describe("freeDay", () => {
  it("is the day after the latest migration on any branch, naming that branch", () => {
    expect(freeDay(fakeSeam())).toEqual({ first: "20270328", latest: { day: "20270327", sources: ["branch origin/RP-583-new"] } });
  });

  it("goes past a later reservation, on main's file or this worktree's, naming the reservation", () => {
    const onMain = `${table}| 20270410 | spec RP-590 | 2 | first ticket |\n`;
    const here = `${table}| 20270412 | RP-591 | 3 | second ticket |\n`;
    expect(freeDay(fakeSeam({ reservations: () => [onMain, table] }))).toEqual({
      first: "20270411",
      latest: { day: "20270410", sources: ["reservation spec RP-590 in origin/main's planning/migration-days.md"] },
    });
    expect(freeDay(fakeSeam({ reservations: () => [onMain, here] })).latest).toEqual({
      day: "20270412",
      sources: ["reservation RP-591 in this worktree's planning/migration-days.md"],
    });
  });

  it("goes past a migration only this worktree has", () => {
    expect(freeDay(fakeSeam({ localMigrations: () => ["20270330000000_mine.sql"] }))).toEqual({ first: "20270331", latest: { day: "20270330", sources: ["this worktree"] } });
  });

  it("names every source of the latest day once: the branches that add the migration, and its reservation", () => {
    const here = `${table}| 20270327 | RP-583 | 5 | review fixes |\n`;
    const result = freeDay(
      fakeSeam({
        remoteBranches: () => [
          { name: "RP-583-new", migrations: ["20270327000000_review_fixes.sql"], sharesHistory: related },
          { name: "gh-readonly-queue/main/pr-1", migrations: ["20270327000000_review_fixes.sql"], sharesHistory: related },
          { name: "RP-590-other", migrations: ["20270327000000_other.sql"], sharesHistory: related },
        ],
        localMigrations: () => ["20270327000000_review_fixes.sql"],
        reservations: () => [here, here],
      }),
    );
    expect(result.latest?.sources).toEqual([
      "branch origin/RP-583-new",
      "branch origin/gh-readonly-queue/main/pr-1",
      "branch origin/RP-590-other",
      "reservation RP-583 in origin/main's planning/migration-days.md",
    ]);
  });

  it("names main alone for a migration main has, not every branch made from it", () => {
    const result = freeDay(
      fakeSeam({
        remoteBranches: () => [
          { name: "RP-583-new", migrations: ["20270326000000_sent_back_built_ins.sql"], sharesHistory: related },
          { name: "main", migrations: ["20270326000000_sent_back_built_ins.sql"], sharesHistory: related },
        ],
      }),
    );
    expect(result).toEqual({ first: "20270327", latest: { day: "20270326", sources: ["branch origin/main"] } });
  });

  it("skips quietly a branch with no history in common with main (screens-*), asking only branches with migrations", () => {
    const asked: string[] = [];
    const seam = fakeSeam({
      remoteBranches: () => [
        { name: "main", migrations: ["20270326000000_sent_back_built_ins.sql"], sharesHistory: () => (asked.push("main"), true) },
        { name: "screens-RP-411", migrations: ["20290101000000_orphan.sql"], sharesHistory: () => (asked.push("screens-RP-411"), false) },
        { name: "screens-RP-438", migrations: [], sharesHistory: () => (asked.push("screens-RP-438"), false) },
      ],
    });
    expect(freeDay(seam)).toEqual({ first: "20270327", latest: { day: "20270326", sources: ["branch origin/main"] } });
    expect(asked).toEqual(["main", "screens-RP-411"]);
  });

  it("ignores files that don't start with a day", () => {
    expect(freeDay(fakeSeam({ localMigrations: () => ["README.sql", "2027_x.sql"] })).first).toBe("20270328");
  });

  it("is today in a repository with no migrations or reservations", () => {
    expect(freeDay(fakeSeam({ remoteBranches: () => [], localMigrations: () => [], reservations: () => ["", ""] }))).toEqual({ first: "20261015" });
  });
});
