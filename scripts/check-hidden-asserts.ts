import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoCitations, type Citation } from "./check-scenario-ids.ts";
import { testBlocks, titlePathAt } from "./test-titles.ts";

// A ratchet on visibility asserts that can pass falsely (RP-1095). An empty read passes a "hidden
// from X" assert for the wrong reason when the row was never made or the read is broken, so such
// an assert goes through expectHiddenFrom (@rabaed/db/test-support), which has a reader who may see
// the row read it first, by id. A compare by a name, a title or a count passes when another row has
// the same name, so visibility asserts compare by id.
//
// An audit on 2026-10-30 found about 280 such asserts already on main. They are listed one per line
// (RP-1134), so a fix and a new false-pass assert in one file don't cancel out. Each entry is keyed
// `<kind> <titles> :: <line>`: the titles of the describe/it blocks around the assert and the text of
// its line, never a line number, so an edit elsewhere in the file doesn't break the check. Each test
// file has its own list, docs/visibility/hidden-asserts/<test file>.txt, so parallel PRs edit
// different files. The lists only shrink: an assert not listed fails, and so does an entry with no
// assert left; a list whose last entry goes is deleted. A line that is no visibility assert (a list of
// errors, say) is marked `// not hidden-from: <why>` and isn't counted.
// Checked by check-hidden-asserts.test.ts, in the unit project.

export const baselineDir = "docs/visibility/hidden-asserts";
/** The baseline of a test file (`apps/api/test/a.test.ts` → `docs/visibility/hidden-asserts/apps/api/test/a.test.ts.txt`). */
export const baselineFileFor = (testFile: string) => `${baselineDir}/${testFile}.txt`;

export type Kind = "empty" | "text";
const kinds: Kind[] = ["empty", "text"];
const describeKind: Record<Kind, string> = {
  empty: 'a "hidden" assert that an empty read passes',
  text: "a compare by text or count",
};
const fixKind: Record<Kind, string> = {
  empty: "prove the row first with expectHiddenFrom (@rabaed/db/test-support), or mark a line that is no hidden-from assert `// not hidden-from: <why>`",
  text: "compare by the row's uuid",
};

const patterns: Record<Kind, RegExp> = {
  empty: /\.toEqual\(\[\]\)|\.toHaveLength\(0\)|\.not\.toContain\(|\.toBeUndefined\(\)|\bexpectHidden\(/g,
  text: /\blegalName\b|\bcompanyName\.en\b|\.name\.en\b|\.toHaveLength\([1-9]\d*\)/g,
};
const skipLine = /\/\/\s*not hidden-from:/;
const topLevel = "(top level)";
const titleSeparator = " > ";

/** One assert: its kind, its key in the baseline, and its line (1-based). */
export type Assert = { kind: Kind; key: string; line: number };

/** The asserts `text` holds, in line order, leaving out marked lines. */
export function findAsserts(file: string, text: string): Assert[] {
  const blocks = testBlocks(file, text);
  const found: Assert[] = [];
  let offset = 0;
  text.split("\n").forEach((raw, i) => {
    if (!skipLine.test(raw)) {
      const lineText = raw.replace(/\s+/g, " ").trim();
      const matches = kinds.flatMap((kind) => [...raw.matchAll(patterns[kind])].map((match) => ({ kind, at: match.index })));
      for (const { kind, at } of matches.sort((a, b) => a.at - b.at)) {
        const titles = titlePathAt(blocks, offset + at).join(titleSeparator) || topLevel;
        found.push({ kind, key: `${kind} ${titles} :: ${lineText}`, line: i + 1 });
      }
    }
    offset += raw.length + 1;
  });
  return found;
}

export type BaselineEntry = { key: string; line: number };
export type BaselineFile = { file: string; text: string };

/** A baseline: one `<kind> <titles> :: <line>` entry a line; blank lines and lines starting with `#` skipped. */
export function parseBaseline(file: string, text: string): BaselineEntry[] {
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return [];
    if (!/^(empty|text) .+ :: .+$/.test(line)) throw new Error(`${file}:${i + 1}: not \`empty|text <titles> :: <line>\``);
    return [{ key: line, line: i + 1 }];
  });
}

const seamTest = (file: string) =>
  (file.startsWith("apps/api/test/") || file.startsWith("packages/db/test/")) && !/\/support\//.test(file) && /\.test\.tsx?$/.test(file);

/** Each seam test file's asserts, by file, leaving out files with none. */
function assertsByFile(files: Citation[]): Map<string, Assert[]> {
  const byFile = new Map<string, Assert[]>();
  for (const { file, text } of files) {
    if (!seamTest(file)) continue;
    const asserts = findAsserts(file, text);
    if (asserts.length > 0) byFile.set(file, asserts);
  }
  return byFile;
}

/** The baselines for `files` as they are now, by file: what to write after an audit. */
export function renderBaselines(files: Citation[]): BaselineFile[] {
  return [...assertsByFile(files)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, asserts]) => ({ file: baselineFileFor(file), text: asserts.map((a) => `${a.key}\n`).join("") }));
}

/** What is wrong with the files' asserts against the baselines; empty when nothing is. */
export function hiddenAssertProblems(files: Citation[], baselines: BaselineFile[]): string[] {
  const problems: string[] = [];
  const asserts = assertsByFile(files);
  const listed = new Map<string, BaselineEntry[]>();
  for (const { file, text } of baselines) {
    if (!file.startsWith(`${baselineDir}/`) || !file.endsWith(".txt")) {
      problems.push(`${file}: not a baseline: use <test path>.txt`);
      continue;
    }
    const entries = parseBaseline(file, text);
    if (entries.length === 0) problems.push(`${file}: lists no assert: delete it`);
    else listed.set(file.slice(baselineDir.length + 1, -".txt".length), entries);
  }

  for (const [file, has] of asserts) {
    const left = new Map<string, number>();
    for (const entry of listed.get(file) ?? []) left.set(entry.key, (left.get(entry.key) ?? 0) + 1);
    for (const assert of has) {
      const n = left.get(assert.key) ?? 0;
      if (n > 0) left.set(assert.key, n - 1);
      else {
        const titles = assert.key.slice(assert.kind.length + 1, assert.key.indexOf(" :: "));
        problems.push(`${file}:${assert.line}: ${describeKind[assert.kind]}, in "${titles}", not in ${baselineFileFor(file)}: ${fixKind[assert.kind]} (RP-1095)`);
      }
    }
  }

  for (const [file, entries] of listed) {
    const left = new Map<string, number>();
    for (const assert of asserts.get(file) ?? []) left.set(assert.key, (left.get(assert.key) ?? 0) + 1);
    for (const entry of entries) {
      const n = left.get(entry.key) ?? 0;
      if (n > 0) left.set(entry.key, n - 1);
      else problems.push(`${baselineFileFor(file)}:${entry.line}: ${file} has no such assert now: delete this line (and the list, if it is its last)`);
    }
  }
  return problems;
}

/** The baseline files of the repository at `repo`, every file under the folder but its README. */
export function readBaselines(repo: string): BaselineFile[] {
  const dir = join(repo, baselineDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll("\\", "/")}`)
    .filter((name) => name !== "README.md")
    .sort()
    .map((name) => ({ file: `${baselineDir}/${name}`, text: readFileSync(join(dir, name), "utf8") }));
}

/** The problems of the repository at `repo`. */
export function repoHiddenAssertProblems(repo: string): string[] {
  return hiddenAssertProblems(repoCitations(repo), readBaselines(repo));
}
