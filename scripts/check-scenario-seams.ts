import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoCitations, type Citation } from "./check-scenario-ids.ts";
import { testBlocks } from "./test-titles.ts";
import { readScenarioRows, scenariosDir, matrixFile, type ScenarioRow } from "./visibility-scenarios.ts";

// Every RP-nnn-n visibility scenario is tested at both seams: the api (seam 1, apps/api/test/)
// and the database with its RLS (seam 2, packages/db/test/). RP-1078, RP-1082 and RP-1083 were
// tested at the api only, and that is how the RP-1079 leak got through (RP-1095).
//
// A test "covers" a scenario when an it(...), test(...) or describe(...) title in a seam test file
// names the scenario's ID (RP-1134); a comment or another string doesn't. The gaps already on main
// when this check came are listed in docs/visibility/untested-seams/, one file per ticket
// (RP-nnn.txt, like docs/visibility/scenarios/), one "RP-nnn-n api|db" a line, so parallel PRs edit
// different files. The list only shrinks: a new gap fails, and so does a listed gap that has its
// test now; a file whose last gap goes is deleted. Rows 1–81 have no Jira key and aren't checked.
// Checked by check-scenario-seams.test.ts, in the unit project.

export const gapsDir = "docs/visibility/untested-seams";
/** The gap file of the ticket `key` (`RP-412` → `docs/visibility/untested-seams/RP-412.txt`). */
export const gapFileFor = (key: string) => `${gapsDir}/${key}.txt`;
const keyOf = (scenario: string) => scenario.replace(/-\d+$/, "");

export type Seam = "api" | "db";
const seamFolder: Record<Seam, string> = { api: "apps/api/test/", db: "packages/db/test/" };
const seams: Seam[] = ["api", "db"];

export type Gap = { id: string; seam: Seam; file: string; line: number };
export type GapFile = { file: string; text: string };

const keyed = /^RP-\d+-\d+$/;
const gapLine = /^(RP-\d+-\d+)\s+(api|db)$/;
const gapFileName = new RegExp(`^${gapsDir}/RP-\\d+\\.txt$`);

/** The gaps of one file: one `RP-nnn-n api` or `RP-nnn-n db` a line; blank lines and `#` comments skipped. */
export function parseGaps(file: string, text: string): Gap[] {
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") return [];
    const match = gapLine.exec(line);
    if (!match) throw new Error(`${file}:${i + 1}: not \`RP-nnn-n api\` or \`RP-nnn-n db\``);
    return [{ id: match[1]!, seam: match[2] as Seam, file, line: i + 1 }];
  });
}

const isSeamTest = (file: string, seam: Seam) =>
  file.startsWith(seamFolder[seam]) && !file.startsWith(`${seamFolder[seam]}support/`) && /\.test\.tsx?$/.test(file);

/** The RP-nnn-n IDs the test titles of `seam` name. */
function namedIn(citations: Citation[], seam: Seam): Set<string> {
  const named = new Set<string>();
  for (const { file, text } of citations) {
    if (!isSeamTest(file, seam)) continue;
    for (const { title } of testBlocks(file, text)) for (const match of title.matchAll(/(?<![\w-])RP-\d+-\d+(?![\w-])/g)) named.add(match[0]);
  }
  return named;
}

/** What is wrong with the scenarios' tests at both seams and with the known gaps; empty when nothing is. */
export function seamProblems(rows: ScenarioRow[], citations: Citation[], gapFiles: GapFile[]): string[] {
  const problems: string[] = [];
  const named = { api: namedIn(citations, "api"), db: namedIn(citations, "db") };
  const listed = new Map<string, Gap>();
  for (const { file, text } of gapFiles) {
    if (!gapFileName.test(file)) {
      problems.push(`${file}: not a gap list: use RP-nnn.txt, the key of the scenarios it lists`);
      continue;
    }
    const gaps = parseGaps(file, text);
    if (gaps.length === 0) problems.push(`${file}: lists no gap: delete it`);
    for (const gap of gaps) {
      const key = `${gap.id} ${gap.seam}`;
      if (listed.has(key)) {
        problems.push(`${file}:${gap.line}: ${key} is listed twice`);
        continue;
      }
      if (gapFileFor(keyOf(gap.id)) !== file) problems.push(`${file}:${gap.line}: ${gap.id} belongs in ${gapFileFor(keyOf(gap.id))}`);
      listed.set(key, gap);
    }
  }

  const ids = new Set(rows.map((row) => row.id));
  for (const gap of listed.values()) {
    if (!ids.has(gap.id)) problems.push(`${gap.file}:${gap.line}: ${gap.id} is no scenario in ${matrixFile} or ${scenariosDir}/`);
    else if (named[gap.seam].has(gap.id)) problems.push(`${gap.file}:${gap.line}: ${gap.id} has a ${gap.seam} test now: delete this line (and the list, if it is its last)`);
  }

  for (const row of rows) {
    if (!keyed.test(row.id)) continue;
    for (const seam of seams) {
      if (named[seam].has(row.id) || listed.has(`${row.id} ${seam}`)) continue;
      problems.push(
        `${row.file}:${row.line}: scenario ${row.id} has no ${seam} test (an it(...) or describe(...) naming it in ${seamFolder[seam]}): add one, or, only for a gap already on main, a line "${row.id} ${seam}" in ${gapFileFor(keyOf(row.id))}`,
      );
    }
  }
  return problems;
}

/** The gap files of the repository at `repo`. */
export function readGapFiles(repo: string): GapFile[] {
  const dir = join(repo, gapsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name !== "README.md")
    .sort()
    .map((name) => ({ file: `${gapsDir}/${name}`, text: readFileSync(join(dir, name), "utf8") }));
}

/** The problems of the repository at `repo`. */
export function repoSeamProblems(repo: string): string[] {
  return seamProblems(readScenarioRows(repo), repoCitations(repo), readGapFiles(repo));
}
