import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matrixFile, scenarioFile, scenarioHeader, scenarioRows, scenarioTables, scenariosDir, type ScenarioRow, type ScenarioSource } from "./visibility-scenarios.ts";

// The visibility scenarios are the visibility test suite's index, and tests cite
// them ("scenario 58"). Rows 1–81 keep their plain numbers, in docs/visibility.md;
// a new row takes an ID from the key of the ticket that adds it, RP-nnn-1,
// RP-nnn-2, …, so two branches never take the same next number (RP-397; a second
// 27–31 went unnoticed on main until then), and goes in that ticket's own file,
// docs/visibility/scenarios/RP-nnn.md, so two branches never edit the same lines
// (RP-1097). scripts/visibility-scenarios.ts reads them.
//
// Checked by scripts/check-scenario-ids.test.ts, in the unit project. Only tests
// and stories are read for citations: migration comments can't be corrected
// once merged (check-migrations-immutable), so they keep the numbers they had.

/** The last plain number a matrix row may use; every later row is RP-nnn-n. */
export const lastPlainNumber = 81;

const plainNumber = /^\d+$/;
const jiraKeyRow = /^RP-(\d+)-\d+$/;
const keyFileName = new RegExp(`^${scenariosDir}/(RP-\\d+)\\.md$`);

export type Citation = { file: string; text: string };

// "scenario 28", "scenarios 27 and 28", "scenarios 11, 30 and 31", "scenarios 27-28",
// "scenario RP-397-1", and a list that wraps onto the next comment line.
const idPattern = String.raw`(?:RP-\d+-\d+|\d+)\b`;
const dashPattern = "[-–]";
const dash = new RegExp(`^${dashPattern}$`);
const gap = String.raw`(?:[ \t]*\r?\n[ \t]*(?:\/\/|\*|--)?)?[ \t]*`;
const joiner = String.raw`${gap}(?:,${gap}(?:and\b)?|and\b|${dashPattern})${gap}`;
const citation = new RegExp(String.raw`\bscenarios?[ \t]+(${idPattern}(?:${joiner}${idPattern})*)`, "gi");

type CitedId = { id: string; index: number };

/** Every scenario ID a text cites, in order, with numeric ranges ("27–29") spelled out. */
export function citedScenarioIds(text: string): string[] {
  return citedIdsWithOffsets(text).map((c) => c.id);
}

function citedIdsWithOffsets(text: string): CitedId[] {
  const found: CitedId[] = [];
  for (const match of text.matchAll(citation)) {
    const list = match[1]!;
    const start = match.index + match[0].length - list.length;
    const tokens = [...list.matchAll(new RegExp(`${idPattern}|${dashPattern}`, "g"))];
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t]!;
      if (dash.test(token[0])) continue;
      const previous = tokens[t - 1]?.[0];
      const from = tokens[t - 2]?.[0];
      if (previous && dash.test(previous) && from && plainNumber.test(from) && plainNumber.test(token[0])) {
        for (let n = Number(from) + 1; n < Number(token[0]); n++) found.push({ id: String(n), index: start + token.index });
      }
      found.push({ id: token[0], index: start + token.index });
    }
  }
  return found;
}

/** What is wrong with a row of docs/visibility.md's matrix: rows 1–81 only. */
function matrixRowProblem(row: ScenarioRow): string | undefined {
  const at = `${row.file}:${row.line}: scenario ${row.id}`;
  if (plainNumber.test(row.id)) {
    return Number(row.id) > lastPlainNumber
      ? `${at} is a plain number above ${lastPlainNumber}; new rows use RP-nnn-n (the Jira key), in ${scenariosDir}/RP-nnn.md`
      : undefined;
  }
  const key = jiraKeyRow.exec(row.id)?.[1];
  if (key === undefined) return `${at} is neither a plain number nor RP-nnn-n`;
  return `${at} goes in ${scenarioFile(`RP-${key}`)}, not in this table: each Jira key has its own RP-nnn.md, so parallel PRs never edit the same lines (RP-1097)`;
}

/** What is wrong with a row of the file of the Jira key `key`: its own RP-key-n rows only. */
function keyRowProblem(row: ScenarioRow, key: string): string | undefined {
  const at = `${row.file}:${row.line}: scenario ${row.id}`;
  const rowKey = jiraKeyRow.exec(row.id)?.[1];
  if (rowKey !== undefined) {
    return `RP-${rowKey}` === key ? undefined : `${at} goes in ${scenarioFile(`RP-${rowKey}`)}: ${key}.md holds only ${key}-n rows`;
  }
  if (plainNumber.test(row.id)) return `${at} goes in ${row.file} only as ${key}-n: plain numbers stop at ${lastPlainNumber}, in ${matrixFile}`;
  return `${at} is not ${key}-n`;
}

/** What is wrong with where a source's scenarios are: a file's name and its one table. */
function layoutProblems(source: ScenarioSource): string[] {
  if (source.file === matrixFile) return [];
  const key = keyFileName.exec(source.file)?.[1];
  if (key === undefined) return [`${source.file}: the folder holds only RP-nnn.md, one per Jira key (RP-1097)`];
  const [first, ...more] = scenarioTables(source);
  if (first === undefined) return [`${source.file}: has no scenario table (\`${scenarioHeader}\`)`];
  return [
    ...(first.header === scenarioHeader ? [] : [`${source.file}:${first.line}: the table's heading row is not \`${scenarioHeader}\``]),
    ...more.map((table) => `${source.file}:${table.line}: a second table; ${key}.md holds one, its scenarios`),
  ];
}

/** What is wrong with the scenarios' IDs and places, and with the citations of them; empty when nothing is. */
export function scenarioIdProblems(sources: ScenarioSource[], cited: Citation[]): string[] {
  const problems = sources.flatMap(layoutProblems);
  const placed = new Set(sources.filter((source) => source.file === matrixFile || keyFileName.test(source.file)).map((source) => source.file));
  const rows = scenarioRows(sources).filter((row) => placed.has(row.file));

  for (const row of rows) {
    const key = keyFileName.exec(row.file)?.[1];
    const problem = key === undefined ? matrixRowProblem(row) : keyRowProblem(row, key);
    if (problem !== undefined) problems.push(problem);
  }

  const rowsById = Map.groupBy(rows, (row) => row.id);
  for (const [scenario, same] of rowsById) {
    if (same.length < 2) continue;
    const places = same.map((row) => `${row.file}:${row.line}`);
    const times = same.length === 2 ? "twice" : `${same.length} times`;
    problems.push(`scenario ${scenario} appears ${times} (${places.slice(0, -1).join(", ")} and ${places.at(-1)})`);
  }

  for (const { file, text } of cited) {
    for (const { id, index } of citedIdsWithOffsets(text)) {
      if (rowsById.has(id)) continue;
      const line = text.slice(0, index).split("\n").length;
      problems.push(`${file}:${line} cites scenario ${id}, which is in neither ${matrixFile} nor ${scenariosDir}/`);
    }
  }
  return problems;
}

const citingFile = /\.(test|stories)\.tsx?$/;

/** The text of every committed test file and story under apps/ and packages/. */
export function repoCitations(repo: string): Citation[] {
  const files = execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], { cwd: repo, encoding: "utf8" })
    .split("\0")
    .filter((file) => citingFile.test(file));
  return files.map((file) => ({ file, text: readFileSync(join(repo, file), "utf8") }));
}
