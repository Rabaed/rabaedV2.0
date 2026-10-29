import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Where the visibility scenarios are, and how to read them (RP-1097). Every ticket used to add its
// rows at the end of one table in docs/visibility.md, so parallel PRs conflicted there and the merge
// queue dropped them (#469, #471, #472 on 2026-10-29). Now:
//   - docs/visibility.md, "## Scenario matrix": the setup and rows 1–81, which never grow (RP-397);
//   - docs/visibility/scenarios/RP-nnn.md: one file per ticket, holding the rows RP-nnn-1, RP-nnn-2, …
//     of the ticket RP-nnn, in one table with the matrix's header. A new ticket adds a new file, so
//     two branches never edit the same lines.
// Read by scripts/check-scenario-ids.ts and by anything else that needs every scenario (a test-
// coverage check, RP-1095): call readScenarioRows(repo), never parse the files again.

export const matrixFile = "docs/visibility.md";
export const scenariosDir = "docs/visibility/scenarios";
/** The header row every scenario table has, the matrix's and each ticket's. */
export const scenarioHeader = "| # | Scenario | Who | Expected |";
const matrixHeading = "## Scenario matrix";

/** The file of the ticket `key` (`RP-412` → `docs/visibility/scenarios/RP-412.md`). */
export const scenarioFile = (key: string) => `${scenariosDir}/${key}.md`;

export type ScenarioSource = { file: string; markdown: string };

/** One scenario: its ID (`58`, `RP-412-1`), where its row is (1-based line), and its three cells as written. */
export type ScenarioRow = { id: string; file: string; line: number; scenario: string; who: string; expected: string };

/** A table: its header row and line (1-based), and its rows after the `|---|` line, each with its line. */
export type Table = { header: string; line: number; rows: { text: string; line: number }[] };

function tables(lines: string[], from: number, onlyFirst: boolean): Table[] {
  const found: Table[] = [];
  let current: Table | undefined;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (!line.startsWith("|")) {
      if (current && onlyFirst) break;
      current = undefined;
      continue;
    }
    if (!current) {
      current = { header: line, line: i + 1, rows: [] };
      found.push(current);
      i++; // the |---| line
      continue;
    }
    current.rows.push({ text: line, line: i + 1 });
  }
  return found;
}

/**
 * The scenario tables of one source: in docs/visibility.md the first table under "## Scenario matrix"
 * (none without that heading); in any other file, every table, so a check can refuse a second one.
 */
export function scenarioTables({ file, markdown }: ScenarioSource): Table[] {
  const lines = markdown.split("\n");
  if (file !== matrixFile) return tables(lines, 0, false);
  const heading = lines.findIndex((line) => line.startsWith(matrixHeading));
  return heading < 0 ? [] : tables(lines, heading + 1, true);
}

function cells(text: string): string[] {
  return text.split("|").slice(1, -1).map((cell) => cell.trim());
}

/** Every row of every scenario table, in the sources' order; a ticket file's second table is not read. */
export function scenarioRows(sources: ScenarioSource[]): ScenarioRow[] {
  return sources.flatMap((source) =>
    (scenarioTables(source)[0]?.rows ?? []).map(({ text, line }) => {
      const [id = "", scenario = "", who = "", expected = ""] = cells(text);
      return { id, file: source.file, line, scenario, who, expected };
    }),
  );
}

const keyNumber = (name: string) => Number(/^RP-(\d+)\.md$/.exec(name)?.[1] ?? Number.POSITIVE_INFINITY);

/** docs/visibility.md, then every file in docs/visibility/scenarios/ by ticket number (anything else after, by name). */
export function scenarioSources(repo: string): ScenarioSource[] {
  const read = (file: string) => ({ file, markdown: readFileSync(join(repo, file), "utf8") });
  const dir = join(repo, scenariosDir);
  const names = existsSync(dir) ? readdirSync(dir) : [];
  names.sort((a, b) => keyNumber(a) - keyNumber(b) || (a < b ? -1 : a > b ? 1 : 0));
  return [read(matrixFile), ...names.map((name) => read(`${scenariosDir}/${name}`))];
}

/** Every scenario in the repository at `repo`. */
export const readScenarioRows = (repo: string): ScenarioRow[] => scenarioRows(scenarioSources(repo));
