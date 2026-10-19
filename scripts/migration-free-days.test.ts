import { describe, expect, it } from "vitest";
import { freeDay, type FreeDaySeam, type Git, isCalendarDay, nextDay, realFreeDaySeam, type RemoteBranch } from "./migration-free-days.ts";

const table = `| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
`;

/** A remote branch that shares main's history, with no reservations file of its own unless given. */
const branch = (name: string, migrations: string[], more: Partial<RemoteBranch> = {}): RemoteBranch => ({
  name,
  migrations,
  sharesHistory: () => true,
  reservations: () => "",
  ...more,
});

// A fake seam: main's and a branch's migrations, the worktree's, and both reservation files.
function fakeSeam(overrides: Partial<FreeDaySeam> = {}): FreeDaySeam {
  return {
    remoteBranches: () => [branch("main", ["20270326000000_sent_back_built_ins.sql"]), branch("RP-583-new", ["20270326000000_sent_back_built_ins.sql", "20270327000000_review_fixes.sql"])],
    localMigrations: () => ["20270326000000_sent_back_built_ins.sql"],
    reservations: () => [table, table],
    today: () => "20261015",
    ...overrides,
  };
}

describe("nextDay", () => {
  it("is the calendar day after, across a month end, a year end and a leap day", () => {
    expect(nextDay("20270327")).toBe("20270328");
    expect(nextDay("20270228")).toBe("20270301");
    expect(nextDay("20271231")).toBe("20280101");
    expect(nextDay("20280228")).toBe("20280229");
    expect(nextDay("20280229")).toBe("20280301");
  });
});

describe("isCalendarDay", () => {
  it("takes a real date and refuses an impossible one", () => {
    expect(isCalendarDay("20280229")).toBe(true);
    expect(isCalendarDay("20270229")).toBe(false);
    expect(isCalendarDay("20270230")).toBe(false);
    expect(isCalendarDay("20271399")).toBe(false);
    expect(isCalendarDay("20270100")).toBe(false);
  });
});

describe("freeDay", () => {
  it("is the day after the latest migration on any branch, naming that branch", () => {
    expect(freeDay(fakeSeam())).toEqual({ first: "20270328", latest: { day: "20270327", sources: ["branch origin/RP-583-new"] }, warnings: [] });
  });

  it("goes past a later reservation, on main's file or this worktree's, naming the reservation", () => {
    const onMain = `${table}| 20270410 | spec RP-590 | 2 | first ticket |\n`;
    const here = `${table}| 20270412 | RP-591 | 3 | second ticket |\n`;
    expect(freeDay(fakeSeam({ reservations: () => [onMain, table] }))).toEqual({
      first: "20270411",
      latest: { day: "20270410", sources: ["reservation spec RP-590 in origin/main's planning/migration-days.md"] },
      warnings: [],
    });
    expect(freeDay(fakeSeam({ reservations: () => [onMain, here] })).latest).toEqual({
      day: "20270412",
      sources: ["reservation RP-591 in this worktree's planning/migration-days.md"],
    });
  });

  it("goes past a day reserved only on another branch, naming that branch's file", () => {
    const onBranch = `${table}| 20270415 | RP-600 | 4 | branch-only day |\n`;
    const seam = fakeSeam({ remoteBranches: () => [branch("main", ["20270326000000_sent_back_built_ins.sql"]), branch("main-4-x", ["20270326000000_sent_back_built_ins.sql"], { reservations: () => onBranch })] });
    expect(freeDay(seam)).toEqual({
      first: "20270416",
      latest: { day: "20270415", sources: ["reservation RP-600 in origin/main-4-x's planning/migration-days.md"] },
      warnings: [],
    });
  });

  it("counts a row main also has as main's, once", () => {
    const shared = `${table}| 20270415 | RP-600 | 4 | on main |\n`;
    const seam = fakeSeam({ reservations: () => [shared, shared], remoteBranches: () => [branch("main", ["20270326000000_a.sql"], { reservations: () => shared }), branch("RP-1-x", ["20270326000000_a.sql"], { reservations: () => shared })] });
    expect(freeDay(seam).latest?.sources).toEqual(["reservation RP-600 in origin/main's planning/migration-days.md"]);
  });

  it("goes past a migration only this worktree has", () => {
    expect(freeDay(fakeSeam({ localMigrations: () => ["20270330000000_mine.sql"] }))).toEqual({ first: "20270331", latest: { day: "20270330", sources: ["this worktree"] }, warnings: [] });
  });

  it("names every source of the latest day once: the branches that add the migration, and its reservation", () => {
    const here = `${table}| 20270327 | RP-583 | 5 | review fixes |\n`;
    const result = freeDay(
      fakeSeam({
        remoteBranches: () => [branch("RP-583-new", ["20270327000000_review_fixes.sql"]), branch("gh-readonly-queue/main/pr-1", ["20270327000000_review_fixes.sql"]), branch("RP-590-other", ["20270327000000_other.sql"])],
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
    const result = freeDay(fakeSeam({ remoteBranches: () => [branch("RP-583-new", ["20270326000000_sent_back_built_ins.sql"]), branch("main", ["20270326000000_sent_back_built_ins.sql"])] }));
    expect(result).toEqual({ first: "20270327", latest: { day: "20270326", sources: ["branch origin/main"] }, warnings: [] });
  });

  it("skips quietly a branch with no history in common with main (screens-*), asking only branches with migrations", () => {
    const asked: string[] = [];
    const orphanRows = `${table}| 20290101 | RP-411 | 1 | orphan |\n`;
    const seam = fakeSeam({
      remoteBranches: () => [
        branch("main", ["20270326000000_sent_back_built_ins.sql"], { sharesHistory: () => (asked.push("main"), true) }),
        branch("screens-RP-411", ["20290101000000_orphan.sql"], { sharesHistory: () => (asked.push("screens-RP-411"), false), reservations: () => orphanRows }),
        branch("screens-RP-438", [], { sharesHistory: () => (asked.push("screens-RP-438"), false), reservations: () => orphanRows }),
      ],
    });
    expect(freeDay(seam)).toEqual({ first: "20270327", latest: { day: "20270326", sources: ["branch origin/main"] }, warnings: [] });
    expect(asked).toEqual(["main", "screens-RP-411"]);
  });

  it("ignores files that don't start with a day", () => {
    expect(freeDay(fakeSeam({ localMigrations: () => ["README.sql", "2027_x.sql"] })).first).toBe("20270328");
  });

  it("warns about and ignores a migration or reservation on a day that isn't a calendar date, naming it", () => {
    const here = `${table}| 20270230 | RP-9 | 2 | thirtieth of February |\n`;
    const result = freeDay(fakeSeam({ localMigrations: () => ["20271399000000_bad.sql"], reservations: () => [table, here] }));
    expect(result.first).toBe("20270328");
    expect(result.warnings).toEqual([
      "Warning: ignored this worktree's migration 20271399000000_bad.sql: 20271399 is not a calendar date.",
      "Warning: ignored the row 20270230 | RP-9 | 2 | thirtieth of February in this worktree's planning/migration-days.md: 20270230 is not a calendar date.",
    ]);
  });

  it("is today in a repository with no migrations or reservations", () => {
    expect(freeDay(fakeSeam({ remoteBranches: () => [], localMigrations: () => [], reservations: () => ["", ""] }))).toEqual({ first: "20261015", warnings: [] });
  });
});

describe("realFreeDaySeam's branches", () => {
  // A fake git: two branches, one with no merge base; `shallow` says whether the clone is shallow.
  function fakeGit(shallow: boolean): Git {
    return (...args) => {
      const [command] = args;
      if (command === "for-each-ref") return { status: 0, stdout: "refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/RP-1-x\n" };
      if (command === "ls-tree") return { status: 0, stdout: "20270326000000_a.sql\n" };
      if (command === "merge-base") return { status: args[2] === "refs/remotes/origin/main" ? 0 : 1, stdout: "" };
      if (command === "rev-parse") return { status: 0, stdout: `${shallow}\n` };
      return { status: 1, stdout: "" };
    };
  }

  it("skips a branch with no merge base in a full clone", () => {
    const branches = realFreeDaySeam(".", fakeGit(false)).remoteBranches();
    expect(branches.map((b) => [b.name, b.sharesHistory()])).toEqual([
      ["main", true],
      ["RP-1-x", false],
    ]);
  });

  it("counts it in a shallow clone, where the merge base may only be missing from the history fetched", () => {
    const branches = realFreeDaySeam(".", fakeGit(true)).remoteBranches();
    expect(branches.map((b) => [b.name, b.sharesHistory()])).toEqual([
      ["main", true],
      ["RP-1-x", true],
    ]);
  });
});
