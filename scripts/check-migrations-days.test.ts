import { describe, expect, it } from "vitest";
import { branchIssue, combineReservations, dayProblems, parseReservations } from "./check-migrations-days.ts";

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
    "| 20270118 | RP-437 | B | Rabaed Default Workflows |",
    "| 20270119 | RP-514 | B | Screen answers |",
  ].join("\n"),
);

const migration = (name: string, sql = "select 1;\n") => ({ name, sql });

describe("parseReservations", () => {
  it("reads a table row per day, and skips everything else", () => {
    expect(reservations).toEqual([
      { day: "20270117", owner: "spec RP-525", lane: "B", purpose: "review fixes" },
      { day: "20270118", owner: "RP-437", lane: "B", purpose: "Rabaed Default Workflows" },
      { day: "20270119", owner: "RP-514", lane: "B", purpose: "Screen answers" },
    ]);
  });
});

describe("combineReservations", () => {
  it("keeps origin/main's reservation of a day, and takes from the branch only days main doesn't reserve", () => {
    const own = parseReservations(["| 20270117 | RP-410 | C | card layout |", "| 20270120 | RP-508 | A | order fixes |"].join("\n"));
    const combined = combineReservations(reservations, own);
    expect(combined).toEqual([...reservations, own[1]]);
    expect(dayProblems([migration("20270117000100_board_card_layout.sql")], combined, "RP-410").refused).toHaveLength(1);
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

  const reviewFixes = "-- Review fixes for spec RP-525 (RP-514, RP-515): a Screen's internal answers\n-- never reach a follow-up item.\n\nselect 1;\n";

  it("takes the issue from the migration's header when the branch names another (an integration branch)", () => {
    expect(dayProblems([migration("20270117100000_review_fixes.sql", reviewFixes)], reservations, "RP-511").refused).toEqual([]);
  });

  it("owns the day only for the first issue on the header's first line, not the others it names", () => {
    expect(dayProblems([migration("20270119100000_review_fixes.sql", reviewFixes)], reservations, "RP-511").refused).toEqual([
      { name: "20270119100000_review_fixes.sql", reservation: reservations[2] },
    ]);
    const rebuilt = "-- Card view layout (RP-410), rebuilt from RP-437's take_transition.\nselect 1;\n";
    expect(dayProblems([migration("20270118000100_board_card_layout.sql", rebuilt)], reservations, "RP-410").refused).toHaveLength(1);
  });

  it("reads only the header's first line, not an issue it mentions further down", () => {
    const sql = "-- Card view layout,\n-- unlike RP-525's review fixes, ...\nselect 1;\n";
    expect(dayProblems([migration("20270117000100_board_card_layout.sql", sql)], reservations, null).refused).toHaveLength(1);
  });

  it("passes an unreserved day, listing it for a warning", () => {
    expect(dayProblems([migration("20270120000000_order_fixes_code.sql")], reservations, "RP-508")).toEqual({ refused: [], unreserved: ["20270120000000_order_fixes_code.sql"] });
  });
});
