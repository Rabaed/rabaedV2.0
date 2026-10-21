import { describe, expect, it } from "vitest";
import type { FreeDaySeam, RemoteBranch } from "./migration-free-days.ts";
import { redayChanges, type RedayInput } from "./migrations-reday.ts";

const head = `# Migration days

| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
`;
const table = (...rows: string[]) => `${head}${rows.map((row) => `${row}\n`).join("")}`;

const branch = (name: string, migrations: string[], reservations = ""): RemoteBranch => ({ name, migrations, sharesHistory: () => true, reservations: () => reservations });

const mainMigrations = ["20271001000000_a.sql", "20271005000000_b.sql"];

// Main's newest is 20271005; this branch (RP-631) added two days' migrations before main overtook them.
function input(overrides: Partial<RedayInput> & { branches?: RemoteBranch[]; mainDays?: string } = {}): RedayInput {
  const { branches, mainDays, ...rest } = overrides;
  const daysFile = rest.daysFile ?? table("| 20271005 | RP-700 | 21 | b |", "| 20271003 | spec RP-631 | 5B | Snag report |", "| 20271004 | RP-640 | 5B | Snag photos |");
  const days: FreeDaySeam = {
    remoteBranches: () => branches ?? [branch("main", mainMigrations)],
    localMigrations: () => [...mainMigrations, "20271003000000_snag_report.sql", "20271003000100_snag_report_index.sql", "20271004000000_snag_photos.sql"],
    reservations: () => [mainDays ?? table("| 20271005 | RP-700 | 21 | b |"), daysFile],
    today: () => "20261022",
  };
  return {
    added: [
      { name: "20271004000000_snag_photos.sql", sql: "-- RP-640: snag photos.\nselect 2;\n" },
      { name: "20271003000000_snag_report.sql", sql: "-- Spec RP-631: snag report.\nselect 1;\n" },
      { name: "20271003000100_snag_report_index.sql", sql: "-- RP-631: its index.\nselect 3;\n" },
    ],
    days,
    daysFile,
    references: new Map(),
    lane: "1b",
    branch: "RP-631-snag-report",
    ...rest,
  };
}

describe("migrations:reday", () => {
  it("moves the branch's migrations past main's newest, in their order, keeping each body and time", () => {
    const changes = redayChanges(input());
    expect(changes.problems).toEqual([]);
    expect(changes.moves.map(({ from, to }) => [from, to])).toEqual([
      ["20271003000000_snag_report.sql", "20271006000000_snag_report.sql"],
      ["20271003000100_snag_report_index.sql", "20271006000100_snag_report_index.sql"],
      ["20271004000000_snag_photos.sql", "20271007000000_snag_photos.sql"],
    ]);
    expect(changes.moves[0]?.sql).toBe("-- Spec RP-631: snag report.\nselect 1;\n");
    expect(changes.moves[2]?.sql).toBe("-- RP-640: snag photos.\nselect 2;\n");
  });

  it("goes past another branch's migrations and reservations, not past this branch's own copies on origin", () => {
    const branches = [
      branch("main", mainMigrations),
      branch("gh-readonly-queue/main/pr-9", [...mainMigrations, "20271008000000_queued.sql"]),
      branch("RP-650-x", mainMigrations, table("| 20271010 | RP-650 | 22 | x |")),
      // This branch on origin: its old days and rows are not in the way.
      branch("RP-631-snag-report", [...mainMigrations, "20271003000000_snag_report.sql", "20271004000000_snag_photos.sql"], table("| 20271003 | spec RP-631 | 5B | Snag report |", "| 20271004 | RP-640 | 5B | Snag photos |")),
    ];
    const changes = redayChanges(input({ branches }));
    expect(changes.moves.map(({ to }) => to)).toEqual(["20271011000000_snag_report.sql", "20271011000100_snag_report_index.sql", "20271012000000_snag_photos.sql"]);
  });

  it("replaces the old rows with rows on the new days, keeping their issue and purpose, and leaves no Unused row", () => {
    const daysFile = table(
      "| 20271005 | RP-700 | 21 | b |",
      "| 20270928 | RP-640 | 5B | Unused: the migration moved to 20271004 |",
      "| 20270928 | RP-621 | 24 | working_copy |",
      "| 20271003 | spec RP-631 | 5B | Snag report (moved from 20270930) |",
      "| 20271004 | RP-640 | 5B | Snag photos |",
      "| 20271004 | RP-641 | 5C | another issue's row on the same day |",
    );
    const changes = redayChanges(input({ daysFile }));
    expect(changes.daysFile).toBe(
      table(
        "| 20271005 | RP-700 | 21 | b |",
        "| 20270928 | RP-621 | 24 | working_copy |",
        "| 20271004 | RP-641 | 5C | another issue's row on the same day |",
        "| 20271006 | spec RP-631 | 1b | Snag report (moved from 20271003) |",
        "| 20271007 | RP-640 | 1b | Snag photos (moved from 20271004) |",
      ),
    );
  });

  it("gives a moved day with no row of its own a row for its migration's issue", () => {
    const daysFile = table("| 20271005 | RP-700 | 21 | b |");
    const changes = redayChanges(input({ daysFile }));
    expect(changes.daysFile).toBe(
      table(
        "| 20271005 | RP-700 | 21 | b |",
        "| 20271006 | RP-631 | 1b | snag_report, snag_report_index (moved from 20271003) |",
        "| 20271007 | RP-640 | 1b | snag_photos (moved from 20271004) |",
      ),
    );
  });

  it("rewrites references to the old names in other files, without chaining one move into the next", () => {
    const references = new Map([
      ["docs/data-model.md", "See `20271003000000_snag_report.sql` and 20271004000000_snag_photos.\n"],
      ["apps/api/src/x.test.ts", "// 20271003000100_snag_report_index.sql\n"],
      ["docs/unrelated.md", "Nothing here.\n"],
    ]);
    // Days 20271001 and 20271006: the first moves onto the second's old day.
    const added = [
      { name: "20271001000000_one.sql", sql: "-- RP-631: one.\n" },
      { name: "20271006000000_two.sql", sql: "-- RP-631: two.\n" },
    ];
    const days: FreeDaySeam = { ...input().days, localMigrations: () => ["20271001000000_one.sql", "20271006000000_two.sql"], remoteBranches: () => [branch("main", ["20271005000000_b.sql"])] };
    const chained = redayChanges(input({ added, days, references: new Map([["docs/x.md", "20271001000000_one then 20271006000000_two\n"]]) }));
    expect(chained.moves.map(({ from, to }) => `${from} -> ${to}`)).toEqual(["20271001000000_one.sql -> 20271006000000_one.sql", "20271006000000_two.sql -> 20271007000000_two.sql"]);
    expect(chained.references.get("docs/x.md")).toBe("20271006000000_one then 20271007000000_two\n");

    const changes = redayChanges(input({ references }));
    expect([...changes.references.keys()]).toEqual(["docs/data-model.md", "apps/api/src/x.test.ts"]);
    expect(changes.references.get("docs/data-model.md")).toBe("See `20271006000000_snag_report.sql` and 20271007000000_snag_photos.\n");
    expect(changes.references.get("apps/api/src/x.test.ts")).toBe("// 20271006000100_snag_report_index.sql\n");
  });

  it("moves nothing when every migration is already past everything else", () => {
    const added = [{ name: "20271009000000_late.sql", sql: "-- RP-631: late.\n" }];
    const daysFile = table("| 20271005 | RP-700 | 21 | b |", "| 20271009 | RP-631 | 1b | late |");
    const changes = redayChanges(input({ added, daysFile }));
    expect(changes.moves).toEqual([]);
    expect(changes.daysFile).toBe(daysFile);
    expect(changes.references.size).toBe(0);
  });

  it("refuses a migration whose header and branch name no issue", () => {
    const added = [{ name: "20271003000000_x.sql", sql: "create table x ();\n" }];
    const changes = redayChanges(input({ added, branch: "main-1-integration" }));
    expect(changes.problems).toEqual(["20271003000000_x.sql names no issue: its header's first line has no RP-nnn and the branch isn't named RP-nnn-…. Add `-- RP-nnn: …` as its first line."]);
    expect(changes.moves).toEqual([]);
  });
});
