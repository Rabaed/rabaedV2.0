import { describe, expect, it } from "vitest";
import { seamProblems, parseGaps, repoSeamProblems, gapFileFor } from "./check-scenario-seams.ts";
import type { ScenarioRow } from "./visibility-scenarios.ts";

// The fixtures build IDs in pieces, so this file never cites a scenario itself.
const id = (key: number, n: number) => `RP-${key}-${n}`;
const row = (scenario: string): ScenarioRow => ({ id: scenario, file: "docs/visibility/scenarios/x.md", line: 7, scenario: "", who: "", expected: "" });
const api = (text: string) => ({ file: "apps/api/test/a.test.ts", text });
const db = (text: string) => ({ file: "packages/db/test/a-rls.test.ts", text });
/** A test whose title names `scenario`. */
const named = (scenario: string) => `it("${scenario}: hidden", () => {});`;
const gaps = (key: number, text: string) => [{ file: gapFileFor(`RP-${key}`), text }];
const gapFile = "docs/visibility/untested-seams/RP-9.txt";

describe("seamProblems", () => {
  it("passes a scenario that a test title in each seam names", () => {
    expect(seamProblems([row(id(9, 1))], [api(named(id(9, 1))), db(`describe("${id(9, 1)}", () => { it("hidden", () => {}); });`)], [])).toEqual([]);
  });

  it("doesn't count an ID named only in a comment, a string or a template title's ${…}", () => {
    const text = [`// ${id(9, 1)}`, `const scenario = "${id(9, 1)}";`, "it(`${scenario}: hidden`, () => {});"].join("\n");
    expect(seamProblems([row(id(9, 1))], [api(text), db(named(id(9, 1)))], [])).toEqual([
      `docs/visibility/scenarios/x.md:7: scenario ${id(9, 1)} has no api test (an it(...) or describe(...) naming it in apps/api/test/): add one, or, only for a gap already on main, a line "${id(9, 1)} api" in docs/visibility/untested-seams/RP-9.txt`,
    ]);
  });

  it("counts a title of it.each, test, describe.skip and a template title", () => {
    const text = [`it.each([1])("${id(9, 1)} %s", () => {});`, `test("${id(9, 2)}", () => {});`, `describe.skip("${id(9, 3)}", () => {});`, `it(\`${id(9, 4)} \${x}\`, () => {});`].join("\n");
    const rows = [1, 2, 3, 4].map((n) => row(id(9, n)));
    expect(seamProblems(rows, [api(text), db(text)], [])).toEqual([]);
  });

  it("names the seam a scenario has no test in", () => {
    expect(seamProblems([row(id(9, 1)), row(id(9, 2))], [api(named(`${id(9, 1)} ${id(9, 2)}`)), db(named(id(9, 2)))], [])).toEqual([
      `docs/visibility/scenarios/x.md:7: scenario ${id(9, 1)} has no db test (an it(...) or describe(...) naming it in packages/db/test/): add one, or, only for a gap already on main, a line "${id(9, 1)} db" in docs/visibility/untested-seams/RP-9.txt`,
    ]);
  });

  it("names both seams when neither has a test", () => {
    expect(seamProblems([row(id(9, 1))], [], [])).toHaveLength(2);
  });

  it("reads a whole ID only: RP-9-1 is not named by RP-9-10", () => {
    expect(seamProblems([row(id(9, 1))], [api(named(id(9, 10))), db(named(id(9, 10)))], [])).toHaveLength(2);
  });

  it("counts only test files in the seam's folder", () => {
    const elsewhere = [
      { file: "apps/web/src/a.test.ts", text: named(id(9, 1)) },
      { file: "packages/db/test-support/a.test.ts", text: named(id(9, 1)) },
      { file: "apps/api/test/support/tower.ts", text: named(id(9, 1)) },
    ];
    expect(seamProblems([row(id(9, 1))], elsewhere, [])).toHaveLength(2);
  });

  it("skips rows 1–81, which have no Jira key", () => {
    expect(seamProblems([row("58")], [], [])).toEqual([]);
  });

  it("lets a known gap stand", () => {
    expect(seamProblems([row(id(9, 1))], [api(named(id(9, 1)))], gaps(9, `${id(9, 1)} db\n`))).toEqual([]);
  });

  it("refuses a known gap that a test now covers, so the list only shrinks", () => {
    expect(seamProblems([row(id(9, 1))], [api(named(id(9, 1))), db(named(id(9, 1)))], gaps(9, `${id(9, 1)} db\n`))).toEqual([
      `${gapFile}:1: ${id(9, 1)} has a db test now: delete this line (and the list, if it is its last)`,
    ]);
  });

  it("refuses a known gap for a scenario that doesn't exist", () => {
    expect(seamProblems([], [], gaps(9, `${id(9, 1)} api`))).toEqual([
      `${gapFile}:1: ${id(9, 1)} is no scenario in docs/visibility.md or docs/visibility/scenarios/`,
    ]);
  });

  it("refuses a known gap listed twice", () => {
    expect(seamProblems([row(id(9, 1))], [api(named(id(9, 1)))], gaps(9, `${id(9, 1)} db\n${id(9, 1)} db`))).toEqual([`${gapFile}:2: ${id(9, 1)} db is listed twice`]);
  });

  it("refuses a gap in another ticket's file", () => {
    expect(seamProblems([row(id(8, 1))], [api(named(id(8, 1)))], gaps(9, `${id(8, 1)} db`))).toEqual([
      `${gapFile}:1: ${id(8, 1)} belongs in docs/visibility/untested-seams/RP-8.txt`,
    ]);
  });

  it("refuses a gap file with no gap left, and a file not named RP-nnn.txt", () => {
    const files = [
      { file: gapFile, text: "# only a comment\n" },
      { file: "docs/visibility/untested-seams/misc.txt", text: "" },
    ];
    expect(seamProblems([], [], files)).toEqual([
      `${gapFile}: lists no gap: delete it`,
      "docs/visibility/untested-seams/misc.txt: not a gap list: use RP-nnn.txt, the key of the scenarios it lists",
    ]);
  });
});

describe("parseGaps", () => {
  it("reads one scenario and seam per line, skipping blanks and # comments", () => {
    expect(parseGaps(gapFile, `# heading\n\n${id(9, 1)} api\n${id(9, 2)} db  # RP-9's area\n`)).toEqual([
      { id: id(9, 1), seam: "api", file: gapFile, line: 3 },
      { id: id(9, 2), seam: "db", file: gapFile, line: 4 },
    ]);
  });

  it("refuses a line it can't read", () => {
    expect(() => parseGaps(gapFile, `${id(9, 1)} web`)).toThrow(`${gapFile}:1: not \`RP-nnn-n api\` or \`RP-nnn-n db\``);
  });
});

describe("the repository", () => {
  it("tests every RP-nnn-n scenario at both seams, by test title, or lists the gap", () => {
    expect(repoSeamProblems(process.cwd())).toEqual([]);
  });
});
