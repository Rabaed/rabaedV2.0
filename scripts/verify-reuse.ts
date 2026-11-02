/* eslint-disable rabaed/no-avoid-terms -- git's and vitest's words (test file, deleted, a step label's note), not the domain's */
import { spawnSync } from "node:child_process";
import { isCiOwnFile } from "./ci-green.ts";
import { isBaselineBotCommit, keepsLabel, realGit, type ReviewedGit } from "./reviewed-label.ts";
import { stampLine, verifiedCommits } from "./verify-gate.ts";
import type { Step } from "./verify-steps.ts";

// RP-1195 item 8: `pnpm verify --pr <n>` builds on the PR body's earlier stamped run when the branch's own commits
// since it change only test files that run covered. It then runs lint, typecheck and the whole unit project, but
// of the seam projects (the slow part) only the changed files, and writes a stamped line for HEAD that says so.
// The gate is unchanged (verify-gate.ts): it reads an ordinary stamped line naming HEAD.
//
// Why that is safe: a test file is not code the app runs, so the earlier run's verdict on every code path holds;
// what can change is only the changed tests themselves, which this run runs. The whole unit project runs again
// because its repo-wide checks (check-scenario-seams, check-hidden-asserts, ci-green's helper check) read the
// seam test files as data. Anything else (code, a helper, a fixture, a config, a deleted test, CI's own files)
// means the full run. Clean merges of main and the screenshot bot's commits are stepped over, as the gate already
// accepts an earlier line across them (onlyCleanCommitsSince). CI still runs every suite in full before the merge.

export interface ReuseGit extends ReviewedGit {
  /** What `commit` changes against its first parent: git's status letter (A, M, D, T, …) and the path, renames split (`--no-renames`). */
  changes(commit: string): { status: string; path: string }[];
}

/** The steps whose test files a reuse run may run on their own, by vitest.config.ts's projects; infra and mail are no verify step. */
type TestStep = "test:unit" | "test:seam1" | "test:seam2";

// vitest.config.ts's include globs, as patterns (only `.test.ts`: no project there includes `.tsx`).
const PROJECTS: [TestStep, RegExp][] = [
  ["test:unit", /^(?:packages\/[^/]+\/src\/|packages\/db\/test-support\/|apps\/[^/]+\/src\/|scripts\/)(?:.*\/)?[^/]+\.test\.ts$/],
  ["test:seam1", /^apps\/(?:api|admin)\/test\/(?:.*\/)?[^/]+\.test\.ts$/],
  ["test:seam2", /^packages\/db\/test\/(?:.*\/)?[^/]+\.test\.ts$/],
];

/** The verify step whose vitest project holds the test file `path`; undefined for anything else. */
export const projectOf = (path: string): TestStep | undefined => PROJECTS.find(([, pattern]) => pattern.test(path))?.[0];

export type ReuseDecision =
  | { reuse: false; why: string }
  | { reuse: true; earlier: string; earlierSteps: string[]; commits: number; files: { step: TestStep; path: string }[] };

/** How many commits the walk down from HEAD follows, as `cleanWalk` (reviewed-label.ts). */
const MAX_COMMITS = 50;

// The gate's line, stamped (verify-gate.ts LINE); the stamp itself is checked by `verifiedCommits`.
const STAMPED = /pnpm verify passed on ([0-9a-f]{7,40}): ([^\n`]*?)\. Stamp [0-9a-f]{16}\./g;

/** The body's stamped lines: the commit and its step names (a label's ` (…)` note left out). */
function stampedRuns(body: string): { commit: string; steps: string[] }[] {
  return [...body.matchAll(STAMPED)].flatMap(([line, commit = "", steps = ""]) =>
    verifiedCommits(line).length === 1 ? [{ commit, steps: steps.split(", ").map((label) => label.replace(/ \(.*$/, "")) }] : [],
  );
}

/**
 * Whether `pnpm verify --pr` may build on the body's earlier stamped run for `head`, and the changed test files if so.
 * The newest stamped commit on HEAD's first-parent line counts; the branch's own commits since it (not clean merges of
 * main, not screenshot-bot commits) must change only test files the stamped run's projects cover, none deleted.
 */
export function testsOnlyReuse(body: string, head: string, git: ReuseGit): ReuseDecision {
  const runs = stampedRuns(body);
  if (runs.length === 0) return { reuse: false, why: "the PR body has no stamped verify line to build on" };
  try {
    const own: string[] = [];
    let current = head;
    let earlier: { commit: string; steps: string[] } | undefined;
    for (let steps = 0; steps <= MAX_COMMITS && !earlier; steps++) {
      earlier = runs.find(({ commit }) => current.startsWith(commit));
      if (earlier) break;
      const parents = git.parents(current);
      const first = parents[0];
      if (first === undefined) break;
      if (parents.length > 1) {
        if (!keepsLabel(first, current, git)) return { reuse: false, why: `${current} is a merge, not a clean merge of main` };
      } else if (!isBaselineBotCommit(current, git)) own.push(current);
      current = first;
    }
    if (!earlier) return { reuse: false, why: `no stamped commit in the PR body (${runs.map(({ commit }) => commit).join(", ")}) is below HEAD on its first-parent line` };
    if (own.length === 0) return { reuse: false, why: `the stamped line on ${earlier.commit} already covers HEAD, so there are no changed test files to re-run` };

    const files = new Map<string, TestStep>();
    for (const { status, path } of own.flatMap((commit) => git.changes(commit))) {
      if (status === "D") return { reuse: false, why: `${path} is deleted (a deleted test needs the full run)` };
      const step = projectOf(path);
      if (step === undefined) return { reuse: false, why: `${path} is not a test file of the unit or seam projects` };
      if (isCiOwnFile(path)) return { reuse: false, why: `${path} is one of CI's own files (scripts/ci-green.ts CI_OWN_FILES)` };
      if (status !== "A" && status !== "M") return { reuse: false, why: `${path} changed in a way other than an edit or an addition (${status})` };
      if (!earlier.steps.includes(step)) return { reuse: false, why: `the stamped run on ${earlier.commit} did not run ${step}, which ${path} is in` };
      files.set(path, step);
    }
    for (const step of ["lint", "typecheck", "test:unit"]) {
      if (!earlier.steps.includes(step)) return { reuse: false, why: `the stamped run on ${earlier.commit} did not run ${step}` };
    }
    return {
      reuse: true,
      earlier: earlier.commit,
      earlierSteps: earlier.steps,
      commits: own.length,
      files: [...files].map(([path, step]) => ({ step, path })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
  } catch (error) {
    return { reuse: false, why: `git could not be read (${error instanceof Error ? error.message.split("\n")[0] : String(error)})` };
  }
}

/** The changed files of `step` in a reuse reuse. */
const filesOf = (reuse: Extract<ReuseDecision, { reuse: true }>, step: string) => reuse.files.filter((file) => file.step === step).map(({ path }) => path);

/** The steps a reuse run runs: lint, typecheck, the whole unit project, then each seam project on its changed files only. */
export function reuseSteps(reuse: Extract<ReuseDecision, { reuse: true }>): (Step & { files?: string[] })[] {
  const seams = (["test:seam1", "test:seam2"] as const).flatMap((step) => {
    const files = filesOf(reuse, step);
    return files.length > 0 ? [{ name: step, script: step, files }] : [];
  });
  return [...["lint", "typecheck", "test:unit"].map((name) => ({ name, script: name })), ...seams];
}

/** What `pnpm verify --pr` prints when it builds on the earlier run. */
export function reuseMessage(pr: number, reuse: Extract<ReuseDecision, { reuse: true }>): string {
  const many = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    `pnpm verify --pr ${pr}: building on the stamped run on ${reuse.earlier}: the branch's ${many(reuse.commits, "commit")} since it change only ${many(reuse.files.length, "test file")}:`,
    ...reuse.files.map(({ step, path }) => `  ${path} (${step})`),
    `It runs lint, typecheck and the whole test:unit, and of the seam suites only these files. \`pnpm verify --pr ${pr} --full\` runs everything.`,
  ].join("\n");
}

/** What `pnpm verify --pr` prints when it runs everything. */
export const fullRunMessage = (pr: number, why: string): string => `pnpm verify --pr ${pr}: full run: ${why}.`;

/**
 * The last line of a reuse run on `sha`: the earlier run's steps, each one run now by its label in `passed` (a seam step
 * also saying how many changed test files it re-ran on top of the earlier run), the others by the earlier commit's run.
 * Stamped only for a clean tree on a known commit, as `finalLine`.
 */
export function reuseLine({ sha, dirty, reuse, passed }: { sha: string; dirty: boolean; reuse: Extract<ReuseDecision, { reuse: true }>; passed: string[] }): string {
  const labels = reuse.earlierSteps.map((step) => {
    const ran = passed.find((label) => label === step || label.startsWith(`${step} (`));
    if (ran === undefined) return `${step} (${reuse.earlier}'s run)`;
    const files = filesOf(reuse, step);
    if (files.length === 0 || step === "test:unit") return ran;
    const note = ran.slice(step.length).replace(/^ \((.*)\)$/, "; $1");
    return `${step} (re-ran ${files.length} changed test file${files.length === 1 ? "" : "s"} on top of ${reuse.earlier}'s run${note})`;
  });
  const line = `pnpm verify passed on ${sha === "" ? "unknown commit" : sha}${dirty ? " (dirty: uncommitted changes)" : ""}: ${labels.join(", ")}.`;
  return dirty || sha === "" ? line : stampLine(line);
}

/** The real git reads: reviewed-label.ts's, plus the status of each path a commit changes. */
export function realReuseGit(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): ReuseGit {
  return {
    ...realGit(cwd, spawn),
    changes(commit) {
      const done = spawn("git", ["diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", commit], { cwd, encoding: "utf8" });
      if (done.status !== 0) throw new Error(`git diff-tree failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
      return (done.stdout ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [status = "", ...path] = line.split("\t");
          return { status: status.slice(0, 1), path: path.join("\t") };
        });
    },
  };
}
