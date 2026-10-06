import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citedScenarioIds, matrixScenarioIds, repoCitations, scenarioIdProblems } from "./check-scenario-ids.ts";

// The fixtures spell "scenario" in pieces, so this file never cites a scenario itself.
const s = "scen" + "ario";

function visibility(rows: string[]): string {
  return [
    "# Visibility",
    "",
    "| # | Layer | Question | Enforced by |",
    "|---|---|---|---|",
    "| 1 | Instance | Is it on my Instance? | Separate deployments |",
    "| 1 | Project | A duplicate in another table is not the matrix | RLS |",
    "| 99 | Audience | Neither is a high number | `audience` |",
    "",
    "## Scenario matrix (becomes the automated visibility test suite)",
    "",
    "| # | Scenario | Who | Expected |",
    "|---|---|---|---|",
    ...rows.map((id) => `| ${id} | Something happens | C1 | Hidden |`),
    "",
    "## Settled rules",
    "",
    "| # | Rule |",
    "|---|---|",
    "| 2 | Not the matrix either |",
  ].join("\n");
}

describe("matrixScenarioIds", () => {
  it("reads the IDs of the matrix only, with their line numbers", () => {
    expect(matrixScenarioIds(visibility(["1", "2", "RP-400-1"]))).toEqual([
      { id: "1", line: 13 },
      { id: "2", line: 14 },
      { id: "RP-400-1", line: 15 },
    ]);
  });
});

describe("citedScenarioIds", () => {
  it.each([
    [`(${s} 28)`, ["28"]],
    [`${s}s 27 and 28`, ["27", "28"]],
    [`${s}s 11, 30 and 31`, ["11", "30", "31"]],
    [`${s}s 27-28`, ["27", "28"]],
    [`${s}s 27–29`, ["27", "28", "29"]],
    [`${s} RP-397-1 and RP-397-2`, ["RP-397-1", "RP-397-2"]],
    [`visibility.md E1, ${s}s 11, 30\n// and 31). The filler`, ["11", "30", "31"]],
    [`Scenario 5's "item"`, ["5"]],
    [`a ${s} that`, []],
  ])("reads %j as %j", (text, ids) => {
    expect(citedScenarioIds(text)).toEqual(ids);
  });
});

describe("scenarioIdProblems", () => {
  it("finds nothing wrong in a matrix with unique IDs and cited IDs that exist", () => {
    const markdown = visibility(["1", "2", "81", "RP-400-1", "RP-400-2", "RP-401-1"]);
    expect(scenarioIdProblems(markdown, [{ file: "a.test.ts", text: `it("x (${s}s 2 and RP-400-2)")` }])).toEqual([]);
  });

  it("names a duplicated ID and both its lines", () => {
    expect(scenarioIdProblems(visibility(["27", "28", "27", "RP-400-1", "RP-400-1"]), [])).toEqual([
      "docs/visibility.md: scenario 27 appears twice (lines 13 and 15)",
      "docs/visibility.md: scenario RP-400-1 appears twice (lines 16 and 17)",
    ]);
  });

  it("refuses a plain number above 81: new rows take an RP-nnn-n ID", () => {
    expect(scenarioIdProblems(visibility(["81", "82"]), [])).toEqual([
      "docs/visibility.md:14: scenario 82 is a plain number above 81; new rows use RP-nnn-n (the Jira key)",
    ]);
  });

  it("refuses an ID that is neither a plain number nor RP-nnn-n", () => {
    expect(scenarioIdProblems(visibility(["RP-400", "rp-1-1"]), [])).toEqual([
      "docs/visibility.md:13: scenario RP-400 is neither a plain number nor RP-nnn-n",
      "docs/visibility.md:14: scenario rp-1-1 is neither a plain number nor RP-nnn-n",
    ]);
  });

  it("names a file that cites a scenario not in the matrix", () => {
    const citations = [
      { file: "apps/api/test/a.test.ts", text: `// ${s}s 1 and 3\nit("y (${s} RP-400-9)")` },
      { file: "packages/ui/src/b.stories.tsx", text: `// ${s} 2` },
    ];
    expect(scenarioIdProblems(visibility(["1", "2"]), citations)).toEqual([
      "apps/api/test/a.test.ts:1 cites scenario 3, which is not in docs/visibility.md",
      "apps/api/test/a.test.ts:2 cites scenario RP-400-9, which is not in docs/visibility.md",
    ]);
  });
});

describe("the repository", () => {
  it("has a scenario matrix whose IDs are unique and well formed, and every test and story cites an ID in it", () => {
    const markdown = readFileSync("docs/visibility.md", "utf8");
    expect(matrixScenarioIds(markdown).length).toBeGreaterThan(70);
    expect(scenarioIdProblems(markdown, repoCitations(process.cwd()))).toEqual([]);
  });
});
