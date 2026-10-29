import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matrixFile, readScenarioRows, scenarioFile, scenarioRows, scenarioSources, scenarioTables, scenariosDir } from "./visibility-scenarios.ts";

// The fixtures spell "scenario" in pieces, so this file never cites a scenario itself.
const s = "scen" + "ario";

const visibility = [
  "# Visibility",
  "",
  "| # | Layer | Question | Enforced by |",
  "|---|---|---|---|",
  "| 1 | Instance | Not the matrix | Separate deployments |",
  "",
  "## Scenario matrix (becomes the automated visibility test suite)",
  "",
  "| # | Scenario | Who | Expected |",
  "|---|---|---|---|",
  "| 1 | C1 engineer saves a Draft | C2, K1 | Hidden |",
  "| 2 | C1 sends it to its PM | K1 | Hidden |",
  "",
  "## Settled rules",
  "",
  "| # | Rule |",
  "|---|---|",
  "| 2 | Not the matrix either |",
].join("\n");

const ticketFile = (key: string, rows: string[]) =>
  [`# ${key} ${s}s`, "", "Rows of the matrix in docs/visibility.md.", "", "| # | Scenario | Who | Expected |", "|---|---|---|---|", ...rows].join("\n");

describe("scenarioRows", () => {
  it("reads the matrix of docs/visibility.md and every ticket's table, cell by cell, with file and line", () => {
    const rows = scenarioRows([
      { file: matrixFile, markdown: visibility },
      { file: scenarioFile("RP-400"), markdown: ticketFile("RP-400", ["| RP-400-1 | K1 opens it | C1 | Sees `it` only |"]) },
    ]);
    expect(rows).toEqual([
      { id: "1", file: matrixFile, line: 11, scenario: "C1 engineer saves a Draft", who: "C2, K1", expected: "Hidden" },
      { id: "2", file: matrixFile, line: 12, scenario: "C1 sends it to its PM", who: "K1", expected: "Hidden" },
      { id: "RP-400-1", file: "docs/visibility/scenarios/RP-400.md", line: 7, scenario: "K1 opens it", who: "C1", expected: "Sees `it` only" },
    ]);
  });
});

describe("scenarioTables", () => {
  it("gives each table's header and rows: the one under the matrix heading in docs/visibility.md, every table in a ticket's file", () => {
    const twoTables = ticketFile("RP-400", ["| RP-400-1 | a | b | c |", "", "| # | Other |", "|---|---|", "| x | y |"]);
    expect(scenarioTables({ file: matrixFile, markdown: visibility }).map((t) => [t.header, t.line, t.rows.length])).toEqual([["| # | Scenario | Who | Expected |", 9, 2]]);
    expect(scenarioTables({ file: scenarioFile("RP-400"), markdown: twoTables }).map((t) => [t.header, t.line, t.rows.length])).toEqual([
      ["| # | Scenario | Who | Expected |", 5, 1],
      ["| # | Other |", 9, 1],
    ]);
  });
});

describe("scenarioSources and readScenarioRows", () => {
  let repo: string | undefined;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("reads docs/visibility.md first, then every file of the folder in ticket-number order", () => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-scenarios-"));
    mkdirSync(join(repo, scenariosDir), { recursive: true });
    writeFileSync(join(repo, matrixFile), visibility);
    writeFileSync(join(repo, scenarioFile("RP-1083")), ticketFile("RP-1083", ["| RP-1083-1 | a | b | c |"]));
    writeFileSync(join(repo, scenarioFile("RP-108")), ticketFile("RP-108", ["| RP-108-1 | a | b | c |"]));
    writeFileSync(join(repo, scenariosDir, "notes.txt"), "a stray file");

    expect(scenarioSources(repo).map((source) => source.file)).toEqual([
      "docs/visibility.md",
      "docs/visibility/scenarios/RP-108.md",
      "docs/visibility/scenarios/RP-1083.md",
      "docs/visibility/scenarios/notes.txt",
    ]);
    expect(readScenarioRows(repo).map((row) => row.id)).toEqual(["1", "2", "RP-108-1", "RP-1083-1"]);
  });

  it("reads docs/visibility.md alone when the folder does not exist", () => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-scenarios-"));
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, matrixFile), visibility);
    expect(scenarioSources(repo).map((source) => source.file)).toEqual([matrixFile]);
  });
});
