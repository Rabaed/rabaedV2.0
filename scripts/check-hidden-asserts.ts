import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoCitations, type Citation } from "./check-scenario-ids.ts";

// A ratchet on visibility asserts that can pass falsely (RP-1095). An empty read passes a "hidden
// from X" assert for the wrong reason when the row was never made or the read is broken, so such
// an assert goes through expectHiddenFrom (@rabaed/db/test-support), which has a reader who may see
// the row read it first, by id. A compare by a name, a title or a count passes when another row has
// the same name, so visibility asserts compare by id.
//
// An audit on 2026-10-30 found about 280 such asserts already on main. Each test file's count of
// them, per kind, is in docs/visibility/hidden-asserts.txt, and that list only shrinks: a file over
// its count fails, and so does a count above what the file holds now. The counts are per file, not
// per line, so an edit elsewhere in a file never breaks the check. A line that is no visibility
// assert (a list of errors, say) is marked `// not hidden-from: <why>` and isn't counted.
// Checked by check-hidden-asserts.test.ts, in the unit project.

export const baselineFile = "docs/visibility/hidden-asserts.txt";

export type Kind = "empty" | "text";
const kinds: Kind[] = ["empty", "text"];
const describeKind: Record<Kind, string> = {
  empty: '"hidden" asserts that an empty read passes',
  text: "compare by text or count",
};
const fixKind: Record<Kind, string> = {
  empty: "prove the row first with expectHiddenFrom (@rabaed/db/test-support), or mark a line that is no hidden-from assert `// not hidden-from: <why>`",
  text: "compare by id",
};

const patterns: Record<Kind, RegExp> = {
  empty: /\.toEqual\(\[\]\)|\.toHaveLength\(0\)|\.not\.toContain\(|\.toBeUndefined\(\)|\bexpectHidden\(/g,
  text: /\blegalName\b|\bcompanyName\.en\b|\.name\.en\b|\.toHaveLength\([1-9]\d*\)/g,
};
const marker = /\/\/\s*not hidden-from:/;

export type Counts = Record<Kind, number>;

/** How many asserts of each kind `text` holds, leaving out marked lines. */
export function countAsserts(text: string): Counts {
  const counts: Counts = { empty: 0, text: 0 };
  for (const line of text.split("\n")) {
    if (marker.test(line)) continue;
    for (const kind of kinds) counts[kind] += [...line.matchAll(patterns[kind])].length;
  }
  return counts;
}

export type BaselineLine = { file: string; kind: Kind; count: number; line: number };

/** The baseline: one `<file> empty|text <count>` a line; blank lines and `#` comments skipped. */
export function parseBaseline(text: string): BaselineLine[] {
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") return [];
    const match = /^(\S+)\s+(empty|text)\s+(\d+)$/.exec(line);
    if (!match) throw new Error(`${baselineFile}:${i + 1}: not \`<file> empty|text <count>\``);
    return [{ file: match[1]!, kind: match[2] as Kind, count: Number(match[3]), line: i + 1 }];
  });
}

const seamTest = (file: string) =>
  (file.startsWith("apps/api/test/") || file.startsWith("packages/db/test/")) && !/\/support\//.test(file) && /\.test\.tsx?$/.test(file);

/** Each seam test file's counts, by file. */
function countsByFile(files: Citation[]): Map<string, Counts> {
  return new Map(files.filter((f) => seamTest(f.file)).map((f) => [f.file, countAsserts(f.text)]));
}

/** The baseline lines for `files` as they are now, sorted: what to write after an audit. */
export function renderBaseline(files: Citation[]): string[] {
  const lines: string[] = [];
  for (const [file, counts] of [...countsByFile(files)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const kind of kinds) if (counts[kind] > 0) lines.push(`${file} ${kind} ${counts[kind]}`);
  }
  return lines;
}

/** What is wrong with the files' asserts against the baseline; empty when nothing is. */
export function hiddenAssertProblems(files: Citation[], baseline: BaselineLine[]): string[] {
  const problems: string[] = [];
  const counts = countsByFile(files);
  const allowed = new Map(baseline.map((b) => [`${b.file} ${b.kind}`, b]));
  for (const [file, has] of counts) {
    for (const kind of kinds) {
      const limit = allowed.get(`${file} ${kind}`)?.count ?? 0;
      if (has[kind] > limit) problems.push(`${file}: ${has[kind]} ${describeKind[kind]}, ${limit} allowed: ${fixKind[kind]} (RP-1095)`);
    }
  }
  for (const b of baseline) {
    const now = counts.get(b.file)?.[b.kind] ?? 0;
    if (now < b.count) problems.push(`${baselineFile}:${b.line}: ${b.file} ${b.kind} is ${now} now: ${now === 0 ? "delete this line" : `lower it to ${now}`}`);
  }
  return problems;
}

/** The problems of the repository at `repo`. */
export function repoHiddenAssertProblems(repo: string): string[] {
  return hiddenAssertProblems(repoCitations(repo), parseBaseline(readFileSync(join(repo, baselineFile), "utf8")));
}
