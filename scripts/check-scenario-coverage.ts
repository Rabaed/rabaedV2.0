import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoCitations, type Citation } from "./check-scenario-ids.ts";
import { readScenarioRows, scenariosDir, matrixFile, type ScenarioRow } from "./visibility-scenarios.ts";

// Every RP-nnn-n visibility scenario is tested at both seams: the api (seam 1, apps/api/test/)
// and the database with its RLS (seam 2, packages/db/test/). RP-1078, RP-1082 and RP-1083 were
// tested at the api only, and that is how the RP-1079 leak got through (RP-1095).
//
// A test "covers" a scenario when its file names the scenario's ID. The gaps already on main when
// this check came are listed in docs/visibility/coverage-gaps.txt, one "RP-nnn-n api|db" a line,
// and the list only shrinks: a new gap fails, and so does a listed gap that has its test now.
// Rows 1–81 have no Jira key and aren't checked. Checked by check-scenario-coverage.test.ts, in
// the unit project.

export const gapsFile = "docs/visibility/coverage-gaps.txt";

export type Seam = "api" | "db";
const seamFolder: Record<Seam, string> = { api: "apps/api/test/", db: "packages/db/test/" };
const seams: Seam[] = ["api", "db"];

export type Gap = { id: string; seam: Seam; line: number };

const keyed = /^RP-\d+-\d+$/;
const gapLine = /^(RP-\d+-\d+)\s+(api|db)$/;

/** The known gaps: one `RP-nnn-n api` or `RP-nnn-n db` a line; blank lines and `#` comments skipped. */
export function parseGaps(text: string): Gap[] {
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") return [];
    const match = gapLine.exec(line);
    if (!match) throw new Error(`${gapsFile}:${i + 1}: not \`RP-nnn-n api\` or \`RP-nnn-n db\``);
    return [{ id: match[1]!, seam: match[2] as Seam, line: i + 1 }];
  });
}

const isSeamTest = (file: string, seam: Seam) =>
  file.startsWith(seamFolder[seam]) && !file.startsWith(`${seamFolder[seam]}support/`) && /\.test\.tsx?$/.test(file);

/** The RP-nnn-n IDs the test files of `seam` name. */
function namedIn(citations: Citation[], seam: Seam): Set<string> {
  const named = new Set<string>();
  for (const { file, text } of citations) {
    if (!isSeamTest(file, seam)) continue;
    for (const match of text.matchAll(/(?<![\w-])RP-\d+-\d+(?![\w-])/g)) named.add(match[0]);
  }
  return named;
}

/** What is wrong with the scenarios' test coverage and with the known gaps; empty when nothing is. */
export function coverageProblems(rows: ScenarioRow[], citations: Citation[], gaps: Gap[]): string[] {
  const problems: string[] = [];
  const named = { api: namedIn(citations, "api"), db: namedIn(citations, "db") };
  const listed = new Map<string, Gap>();
  for (const gap of gaps) {
    const key = `${gap.id} ${gap.seam}`;
    if (listed.has(key)) problems.push(`${gapsFile}:${gap.line}: ${key} is listed twice`);
    else listed.set(key, gap);
  }

  const ids = new Set(rows.map((row) => row.id));
  for (const gap of listed.values()) {
    if (!ids.has(gap.id)) problems.push(`${gapsFile}:${gap.line}: ${gap.id} is no scenario in ${matrixFile} or ${scenariosDir}/`);
    else if (named[gap.seam].has(gap.id)) problems.push(`${gapsFile}:${gap.line}: ${gap.id} has a ${gap.seam} test now: delete this line`);
  }

  for (const row of rows) {
    if (!keyed.test(row.id)) continue;
    for (const seam of seams) {
      if (named[seam].has(row.id) || listed.has(`${row.id} ${seam}`)) continue;
      problems.push(
        `${row.file}:${row.line}: scenario ${row.id} has no ${seam} test (${seamFolder[seam]}): add one, or, only for a gap already on main, a line "${row.id} ${seam}" in ${gapsFile}`,
      );
    }
  }
  return problems;
}

/** The problems of the repository at `repo`. */
export function repoCoverageProblems(repo: string): string[] {
  const gaps = parseGaps(readFileSync(join(repo, gapsFile), "utf8"));
  return coverageProblems(readScenarioRows(repo), repoCitations(repo), gaps);
}
