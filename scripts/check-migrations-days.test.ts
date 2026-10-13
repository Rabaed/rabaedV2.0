import { describe, expect, it } from "vitest";
import { branchIssue, dayProblems, parseReservations } from "./check-migrations-days.ts";

// Migration days (RP-560): planning/migration-days.md reserves a day of
// migration timestamps for one issue or spec, and a migration another issue
// adds on that day is refused (RP-525's reserved 20270117, taken on main).
const reservations = parseReservations(
  [
    "# Migration days",
    "",
    "| Day | Issue | Lane | Note |",
    "| --- | --- | --- | --- |",
    "| 20270117 | spec RP-525 | B | review fixes |",
    "20270118 | RP-437 | B | Rabaed Default Workflows",
  ].join("\n"),
);

const migration = (name: string, sql = "select 1;\n") => ({ name, sql });

describe("parseReservations", () => {
  it("reads a line per day, in a table or as plain lines, and skips everything else", () => {
    expect(reservations).toEqual([
      { day: "20270117", owner: "spec RP-525", lane: "B", purpose: "review fixes" },
      { day: "20270118", owner: "RP-437", lane: "B", purpose: "Rabaed Default Workflows" },
    ]);
  });
});

describe("branchIssue", () => {
  it("takes the issue from a branch named RP-nnn-…, and none from any other", () => {
    expect(branchIssue("RP-560-migration-days")).toBe("RP-560");
    expect(branchIssue("worktree-agent-a8265c0f")).toBeNull();
    expect(branchIssue("HEAD")).toBeNull();
  });
});

describe("dayProblems", () => {
  it("refuses a migration on another issue's reserved day, naming the reservation", () => {
    const problems = dayProblems([migration("20270117000100_board_card_layout.sql")], reservations, "RP-410");
    expect(problems.refused).toEqual([{ name: "20270117000100_board_card_layout.sql", reservation: reservations[0] }]);
  });

  it("passes a migration on its own issue's day", () => {
    expect(dayProblems([migration("20270118000000_rabaed_default_types.sql")], reservations, "RP-437")).toEqual({ refused: [], unreserved: [] });
  });

  it("takes the issue from the migration's header when the branch names another (an integration branch)", () => {
    const sql = "-- Review fixes for spec RP-525 (RP-514, RP-515): a Screen's internal answers\n-- never reach a follow-up item.\n\nselect 1;\n";
    expect(dayProblems([migration("20270117100000_review_fixes.sql", sql)], reservations, "RP-511").refused).toEqual([]);
  });

  it("reads only the header's first paragraph, not an issue it mentions further down", () => {
    const sql = "-- Card view layout (RP-410).\n--\n-- Unlike RP-525's review fixes, ...\nselect 1;\n";
    expect(dayProblems([migration("20270117000100_board_card_layout.sql", sql)], reservations, null).refused).toHaveLength(1);
  });

  it("passes an unreserved day, listing it for a warning", () => {
    expect(dayProblems([migration("20270120000000_order_fixes_code.sql")], reservations, "RP-508")).toEqual({ refused: [], unreserved: ["20270120000000_order_fixes_code.sql"] });
  });
});
