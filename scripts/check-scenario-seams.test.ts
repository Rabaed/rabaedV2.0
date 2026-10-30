import { describe, expect, it } from "vitest";
import { seamProblems, parseGaps, repoSeamProblems } from "./check-scenario-seams.ts";
import type { ScenarioRow } from "./visibility-scenarios.ts";

// The fixtures build IDs in pieces, so this file never cites a scenario itself.
const id = (key: number, n: number) => `RP-${key}-${n}`;
const row = (scenario: string): ScenarioRow => ({ id: scenario, file: "docs/visibility/scenarios/x.md", line: 7, scenario: "", who: "", expected: "" });
const api = (text: string) => ({ file: "apps/api/test/a.test.ts", text });
const db = (text: string) => ({ file: "packages/db/test/a-rls.test.ts", text });

describe("seamProblems", () => {
  it("passes a scenario that a test in each seam names", () => {
    expect(seamProblems([row(id(9, 1))], [api(`// ${id(9, 1)}`), db(`it("${id(9, 1)}: hidden")`)], [])).toEqual([]);
  });

  it("names the seam a scenario has no test in", () => {
    expect(seamProblems([row(id(9, 1)), row(id(9, 2))], [api(`${id(9, 1)} ${id(9, 2)}`), db(id(9, 2))], [])).toEqual([
      `docs/visibility/scenarios/x.md:7: scenario ${id(9, 1)} has no db test (packages/db/test/): add one, or, only for a gap already on main, a line "${id(9, 1)} db" in docs/visibility/untested-seams.txt`,
    ]);
  });

  it("names both seams when neither has a test", () => {
    expect(seamProblems([row(id(9, 1))], [], [])).toHaveLength(2);
  });

  it("reads a whole ID only: RP-9-1 is not named by RP-9-10", () => {
    expect(seamProblems([row(id(9, 1))], [api(id(9, 10)), db(id(9, 10))], [])).toHaveLength(2);
  });

  it("counts only test files in the seam's folder", () => {
    const elsewhere = [
      { file: "apps/web/src/a.test.ts", text: id(9, 1) },
      { file: "packages/db/test-support/a.test.ts", text: id(9, 1) },
      { file: "apps/api/test/support/tower.ts", text: id(9, 1) },
    ];
    expect(seamProblems([row(id(9, 1))], elsewhere, [])).toHaveLength(2);
  });

  it("skips rows 1–81, which have no Jira key", () => {
    expect(seamProblems([row("58")], [], [])).toEqual([]);
  });

  it("lets a known gap stand", () => {
    const gaps = parseGaps(`${id(9, 1)} db\n`);
    expect(seamProblems([row(id(9, 1))], [api(id(9, 1))], gaps)).toEqual([]);
  });

  it("refuses a known gap that a test now covers, so the list only shrinks", () => {
    const gaps = parseGaps(`${id(9, 1)} db\n`);
    expect(seamProblems([row(id(9, 1))], [api(id(9, 1)), db(id(9, 1))], gaps)).toEqual([
      `docs/visibility/untested-seams.txt:1: ${id(9, 1)} has a db test now: delete this line`,
    ]);
  });

  it("refuses a known gap for a scenario that doesn't exist", () => {
    expect(seamProblems([], [], parseGaps(`${id(9, 1)} api`))).toEqual([
      `docs/visibility/untested-seams.txt:1: ${id(9, 1)} is no scenario in docs/visibility.md or docs/visibility/scenarios/`,
    ]);
  });

  it("refuses a known gap listed twice", () => {
    const gaps = parseGaps(`${id(9, 1)} db\n${id(9, 1)} db`);
    expect(seamProblems([row(id(9, 1))], [api(id(9, 1))], gaps)).toEqual([`docs/visibility/untested-seams.txt:2: ${id(9, 1)} db is listed twice`]);
  });
});

describe("parseGaps", () => {
  it("reads one scenario and seam per line, skipping blanks and # comments", () => {
    expect(parseGaps(`# heading\n\n${id(9, 1)} api\n${id(9, 2)} db  # RP-9's area\n`)).toEqual([
      { id: id(9, 1), seam: "api", line: 3 },
      { id: id(9, 2), seam: "db", line: 4 },
    ]);
  });

  it("refuses a line it can't read", () => {
    expect(() => parseGaps(`${id(9, 1)} web`)).toThrow("docs/visibility/untested-seams.txt:1: not `RP-nnn-n api` or `RP-nnn-n db`");
  });
});

describe("the repository", () => {
  it("tests every RP-nnn-n scenario at both seams, or lists the gap", () => {
    expect(repoSeamProblems(process.cwd())).toEqual([]);
  });
});
