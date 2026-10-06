import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The scenario matrix in docs/visibility.md is the visibility test suite's
// index, and tests cite its rows ("scenario 58"). Rows 1–81 keep their plain
// numbers; a new row takes an ID from the key of the ticket that adds it,
// RP-nnn-1, RP-nnn-2, …, so two branches never take the same next number
// (RP-397). A second 27–31 went unnoticed on main until then.
//
// Checked by scripts/check-scenario-ids.test.ts, in the unit project. Only tests
// and stories are read for citations: migration comments can't be corrected
// once merged (check-migrations-immutable), so they keep the numbers they had.

/** The last plain number a matrix row may use; every later row is RP-nnn-n. */
export const lastPlainNumber = 81;

const matrixFile = "docs/visibility.md";
const plainNumber = /^\d+$/;
const jiraKeyRow = /^RP-\d+-\d+$/;

export type MatrixRow = { id: string; line: number };
export type Citation = { file: string; text: string };

/** The first cell of every row of the "Scenario matrix" table, with its 1-based line. */
export function matrixScenarioIds(markdown: string): MatrixRow[] {
  const lines = markdown.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("## Scenario matrix"));
  if (heading < 0) return [];
  const rows: MatrixRow[] = [];
  let inTable = false;
  for (let i = heading + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    if (!inTable) {
      inTable = true;
      i++; // the header row, then this skips the |---| row
      continue;
    }
    rows.push({ id: line.split("|")[1]!.trim(), line: i + 1 });
  }
  return rows;
}

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

/** What is wrong with the matrix's IDs and with the citations of them; empty when nothing is. */
export function scenarioIdProblems(markdown: string, cited: Citation[]): string[] {
  const rows = matrixScenarioIds(markdown);
  const problems: string[] = [];

  for (const row of rows) {
    if (plainNumber.test(row.id)) {
      if (Number(row.id) > lastPlainNumber) {
        problems.push(`${matrixFile}:${row.line}: scenario ${row.id} is a plain number above ${lastPlainNumber}; new rows use RP-nnn-n (the Jira key)`);
      }
    } else if (!jiraKeyRow.test(row.id)) {
      problems.push(`${matrixFile}:${row.line}: scenario ${row.id} is neither a plain number nor RP-nnn-n`);
    }
  }

  const linesById = Map.groupBy(rows, (row) => row.id);
  for (const [scenario, same] of linesById) {
    if (same.length < 2) continue;
    const lines = same.map((row) => row.line);
    const times = same.length === 2 ? "twice" : `${same.length} times`;
    problems.push(`${matrixFile}: scenario ${scenario} appears ${times} (lines ${lines.slice(0, -1).join(", ")} and ${lines.at(-1)})`);
  }

  for (const { file, text } of cited) {
    for (const { id, index } of citedIdsWithOffsets(text)) {
      if (linesById.has(id)) continue;
      const line = text.slice(0, index).split("\n").length;
      problems.push(`${file}:${line} cites scenario ${id}, which is not in ${matrixFile}`);
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
