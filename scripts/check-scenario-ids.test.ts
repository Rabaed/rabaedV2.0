import { describe, expect, it } from "vitest";
import { citedScenarioIds, lastPlainNumber, repoCitations, scenarioIdProblems } from "./check-scenario-ids.ts";
import { matrixFile, readScenarioRows, scenarioFile, scenarioSources, scenariosDir, type ScenarioSource } from "./visibility-scenarios.ts";

// The fixtures spell "scenario" in pieces, so this file never cites a scenario itself.
const s = "scen" + "ario";

function visibility(rows: string[]): ScenarioSource {
  const markdown = [
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
  return { file: matrixFile, markdown };
}

/** A ticket's file: its rows start on line 7. */
function ticket(key: string, rows: string[], options: { header?: string; file?: string; extra?: string[] } = {}): ScenarioSource {
  const markdown = [
    `# ${key} ${s}s`,
    "",
    "Rows of the matrix in docs/visibility.md, with its setup.",
    "",
    options.header ?? "| # | Scenario | Who | Expected |",
    "|---|---|---|---|",
    ...rows.map((id) => `| ${id} | Something happens | C1 | Hidden |`),
    ...(options.extra ?? []),
  ].join("\n");
  return { file: options.file ?? scenarioFile(key), markdown };
}

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
  it("finds nothing wrong in rows 1–81 in the matrix, each ticket's rows in its own file, and cited IDs that exist", () => {
    const sources = [visibility(["1", "2", "81"]), ticket("RP-400", ["RP-400-1", "RP-400-2"]), ticket("RP-401", ["RP-401-1"])];
    expect(scenarioIdProblems(sources, [{ file: "a.test.ts", text: `it("x (${s}s 2 and RP-400-2)")` }])).toEqual([]);
  });

  it("names a duplicated ID and every place it is", () => {
    const sources = [visibility(["27", "28", "27"]), ticket("RP-400", ["RP-400-1", "RP-400-1"])];
    expect(scenarioIdProblems(sources, [])).toEqual([
      "scenario 27 appears twice (docs/visibility.md:13 and docs/visibility.md:15)",
      "scenario RP-400-1 appears twice (docs/visibility/scenarios/RP-400.md:7 and docs/visibility/scenarios/RP-400.md:8)",
    ]);
  });

  it("refuses a plain number above the last one: new rows take an RP-nnn-n ID", () => {
    const next = lastPlainNumber + 1;
    expect(scenarioIdProblems([visibility([String(lastPlainNumber), String(next)])], [])).toEqual([
      `docs/visibility.md:14: scenario ${next} is a plain number above ${lastPlainNumber}; new rows use RP-nnn-n (the Jira key), in docs/visibility/scenarios/RP-nnn.md`,
    ]);
  });

  it("refuses an ID that is neither a plain number nor RP-nnn-n", () => {
    expect(scenarioIdProblems([visibility(["RP-400", "rp-1-1"])], [])).toEqual([
      "docs/visibility.md:13: scenario RP-400 is neither a plain number nor RP-nnn-n",
      "docs/visibility.md:14: scenario rp-1-1 is neither a plain number nor RP-nnn-n",
    ]);
  });

  it("sends an RP-nnn-n row in docs/visibility.md to its ticket's own file", () => {
    expect(scenarioIdProblems([visibility(["1", "RP-400-1"])], [])).toEqual([
      'docs/visibility.md:14: scenario RP-400-1: move this row, unchanged, to docs/visibility/scenarios/RP-400.md (made like the others in docs/visibility/scenarios/: a "# RP-400 scenarios" heading and one table headed `| # | Scenario | Who | Expected |`) and delete it here; since RP-1097 the table in docs/visibility.md holds rows 1–81 only, so parallel PRs never edit the same lines',
    ]);
  });

  it("refuses a ticket file's row that belongs to another ticket, or is a plain number", () => {
    expect(scenarioIdProblems([visibility(["1"]), ticket("RP-400", ["RP-400-1", "RP-40-1", "2", "RP-400"])], [])).toEqual([
      "docs/visibility/scenarios/RP-400.md:8: scenario RP-40-1 goes in docs/visibility/scenarios/RP-40.md: RP-400.md holds only RP-400-n rows",
      "docs/visibility/scenarios/RP-400.md:9: scenario 2 goes in docs/visibility/scenarios/RP-400.md only as RP-400-n: plain numbers stop at 81, in docs/visibility.md",
      "docs/visibility/scenarios/RP-400.md:10: scenario RP-400 is not RP-400-n",
    ]);
  });

  it("refuses a file in the folder not named RP-nnn.md, a ticket file without the matrix's table, and a second table", () => {
    const sources = [
      visibility(["1"]),
      ticket("RP-400", ["RP-400-1"], { file: `${scenariosDir}/rp-400.md` }),
      ticket("RP-401", ["RP-401-1"], { header: "| # | Scenario | Expected |" }),
      { file: scenarioFile("RP-402"), markdown: "# RP-402\n\nNo table." },
      ticket("RP-403", ["RP-403-1"], { extra: ["", "| # | Note |", "|---|---|", "| a | b |"] }),
    ];
    expect(scenarioIdProblems(sources, [])).toEqual([
      "docs/visibility/scenarios/rp-400.md: the folder holds only RP-nnn.md, one per Jira key (RP-1097)",
      "docs/visibility/scenarios/RP-401.md:5: the table's heading row is not `| # | Scenario | Who | Expected |`",
      "docs/visibility/scenarios/RP-402.md: has no scenario table (`| # | Scenario | Who | Expected |`)",
      "docs/visibility/scenarios/RP-403.md:9: a second table; RP-403.md holds one, its scenarios",
    ]);
  });

  it("names a file that cites a scenario that is nowhere", () => {
    const citations = [
      { file: "apps/api/test/a.test.ts", text: `// ${s}s 1 and 3\nit("y (${s} RP-400-9 and RP-401-1)")` },
      { file: "packages/ui/src/b.stories.tsx", text: `// ${s} 2` },
    ];
    expect(scenarioIdProblems([visibility(["1", "2"]), ticket("RP-401", ["RP-401-1"])], citations)).toEqual([
      "apps/api/test/a.test.ts:1 cites scenario 3, which is in neither docs/visibility.md nor docs/visibility/scenarios/",
      "apps/api/test/a.test.ts:2 cites scenario RP-400-9, which is in neither docs/visibility.md nor docs/visibility/scenarios/",
    ]);
  });
});

describe("the repository", () => {
  it("has scenarios whose IDs are unique and well formed, each in its place, and every test and story cites one that exists", () => {
    expect(readScenarioRows(process.cwd()).length).toBeGreaterThan(200);
    expect(scenarioIdProblems(scenarioSources(process.cwd()), repoCitations(process.cwd()))).toEqual([]);
  });
});
