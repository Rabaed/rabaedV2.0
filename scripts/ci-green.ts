import { matrixFile, scenarioRows, scenariosDir } from "./visibility-scenarios.ts";

// CI green counts as the verify (RP-1190, owner's decision of 2026-10-31: "I agree if CI of GitHub do it the
// test"). A PR's head passes the verify gate when the stamped `pnpm verify` line names it (RP-1094, still
// accepted) or when GitHub CI's `ci.yml` run on `pull_request` for that exact head finished green: every check
// the main ruleset requires that ci.yml reports passed, none skipped. One rule for the verify-gate check,
// reviewed-add and `pnpm queue`; each reads the evidence its own way and asks `verifiedOrGreen` (verify-gate.ts).
//
// A PR must not weaken its own gate: `pull_request` runs the PR's own copy of ci.yml, its configs and the
// scripts it calls, so a PR could rename or empty a job. A CI run does not count for a PR that changes any of
// CI's own files (`CI_OWN_FILES`, and a package.json's `scripts`); it needs the stamped line. Any API error,
// missing data or doubt refuses. A fork's run never counts.

/** The workflow whose runs count, by its path (as a run reports it) and its file name (as the API names it). */
export const CI_WORKFLOW = ".github/workflows/ci.yml";
const CI_WORKFLOW_FILE = "ci.yml";

/**
 * Required checks of the main ruleset that another workflow reports, with that workflow: not ci.yml jobs, so a
 * CI run is not held to them. Every other required check must be a job of the run. A check added to the ruleset
 * from a new workflow makes every CI run refuse until it is named here (fail closed).
 */
export const OTHER_REQUIRED_CHECKS: Readonly<Record<string, string>> = {
  "verify-gate": ".github/workflows/verify-gate.yml",
  "reviewed-required": ".github/workflows/reviewed-required.yml",
  gitleaks: ".github/workflows/secret-scan.yml",
};

/**
 * CI's own files: what decides what CI runs and how it judges it. A change to one voids the PR's CI run as a
 * verify. A leading `**` and slash is any folder, `*` anything but a slash. ci-green.test.ts checks that every script and local
 * action a PR-facing workflow runs (with the package.json scripts it calls), every test config and what it loads,
 * and everything those and the files here import is here (`ciOwnGaps`). App code
 * and tests are not: CI tests them, and review reads them. A package.json counts on any change but its `version`
 * or `description` (`ciOwnChanges`): CI calls `pnpm test:unit` and the like, `pnpm install` runs lifecycle scripts,
 * and its dependencies, overrides and `packageManager` choose the tools that run the tests.
 */
export const CI_OWN_FILES: readonly string[] = [
  CI_WORKFLOW,
  // The other workflows that judge a PR (on pull_request or merge_group): the gate's own and those reporting a required
  // check (RP-1194). A PR's run of one uses the PR's own copy. Named one by one, not `.github/workflows/*`: the deploys,
  // the manual jobs and those that run once the verdict is in (jira-close, queue-drop-comment) judge nothing.
  // eslint-disable-next-line rabaed/no-avoid-terms -- the workflow's file name (npm's word), not the domain's
  ".github/workflows/dependency-audit.yml",
  ".github/workflows/reviewed-add.yml",
  ".github/workflows/reviewed-label.yml",
  ".github/workflows/reviewed-required.yml",
  ".github/workflows/secret-scan.yml",
  // Its second render and flip-flop check decide which screenshot baselines the bot commits.
  ".github/workflows/update-screenshots.yml",
  ".github/workflows/verify-gate.yml",
  ".github/actions/**",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/vite.config.*",
  "**/playwright.config.*",
  "eslint.config.*",
  "packages/eslint-plugin/**",
  "**/tsconfig*.json",
  "**/.storybook/**",
  // The image CI's "web image starts" job builds.
  "**/Dockerfile*",
  "**/.dockerignore",
  // The shared test helpers (`expectHiddenFrom`, the towers, the id sweeps): one that returns early turns every test
  // using it green. Any other non-test code under a test/ folder counts too (`isTestHelper`).
  "**/test-support/**",
  "**/test/support/**",
  "scripts/*.fixtures.ts",
  // The repo-wide checks unit tests run against the real repo (scenario IDs, leak channels, hidden asserts): CI's
  // judges, not code under test. Their own tests match too.
  "scripts/check-*.ts",
  // Dependencies: a swapped vitest, an override or an install script decides what the tests do.
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  // The vitest configs' global setups (the other two are under test-support/ and test/support/).
  "scripts/test-services.ts",
  // The scripts ci.yml and the root scripts run, and the scripts/ files they import.
  "scripts/check-migration-drift.ts",
  "scripts/check-migrations-hidden-sort.ts",
  "scripts/check-migrations-immutable.ts",
  "scripts/check-workflows.ts",
  "scripts/ci-green.ts",
  "scripts/claims.ts",
  "scripts/claude-sessions.ts",
  "scripts/db-fn.ts",
  "scripts/design-strip-fonts.ts",
  "scripts/desktop-sessions.ts",
  "scripts/docs-only.ts",
  "scripts/hidden-columns.ts",
  "scripts/lanes.ts",
  "scripts/migrations.ts",
  "scripts/new-screenshots-reporter.ts",
  "scripts/paths.ts",
  "scripts/pnpm.ts",
  "scripts/pr-overlap.ts",
  "scripts/reviewed-label.ts",
  "scripts/reviewed-required.ts",
  "scripts/session-lock.ts",
  "scripts/story-run.ts",
  "scripts/test-timing.ts",
  "scripts/test-titles.ts",
  "scripts/typecheck.ts",
  "scripts/verify-gate.ts",
  "scripts/visibility-scenarios.ts",
  "scripts/worktrees-stale.ts",
  "scripts/worktrees.ts",
  // The scripts the other PR-facing workflows run: reviewed-add's label, the pnpm audit check, update-screenshots'
  // second render and flip-flop check.
  "scripts/reviewed-add.ts",
  // eslint-disable-next-line rabaed/no-avoid-terms -- the script's file name (npm's word), not the domain's
  "scripts/dependency-audit.ts",
  // eslint-disable-next-line rabaed/no-avoid-terms -- the script's file name (npm's word), not the domain's
  "scripts/dependency-audit-needed.ts",
  "scripts/unstable-screenshots-reporter.ts",
  "scripts/screenshot-flip-flop.ts",
  // Root package.json's `prepare`, which every `pnpm install` in CI runs.
  "scripts/hooks-install.ts",
];

const globPattern = (glob: string) =>
  new RegExp(
    `^${glob
      .split(/(\*\*\/|\*\*|\*)/)
      .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
      .join("")}$`,
  );
const OWN = CI_OWN_FILES.map(globPattern);

/** Code in a test/ folder that is not itself a test (`*.test.ts(x)`) nor test data under test/fixtures/: a helper. */
const isTestHelper = (path: string) => /(^|\/)test\/(?!fixtures\/)(.+\/)?[^/]+\.[cm]?[jt]sx?$/.test(path) && !/\.test\.[cm]?[jt]sx?$/.test(path);

/** True for a path in `CI_OWN_FILES`, or a test helper. ci-green.test.ts checks every helper a test imports is one. */
export const isCiOwnFile = (path: string): boolean => isTestHelper(path) || OWN.some((pattern) => pattern.test(path));

/** A package.json's fields that matter to CI (all but `version` and `description`), as comparable text; undefined when it cannot be read. */
const ciFieldsOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return JSON.stringify({});
  try {
    const { version: _version, description: _description, ...rest } = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return undefined;
  }
};

/**
 * The visibility ratchets: lists of known weak asserts (scripts/check-hidden-asserts.ts) and untested scenarios
 * (scripts/check-scenario-seams.ts) that may only shrink. The checks read the PR's own list, in CI and in `pnpm
 * queue`'s merge checks alike, so a list that gains an entry lets a weaker test through: its CI run does not count.
 * One that only shrinks, or goes, is the fix they ask for. The verify gate and `pnpm queue` also refuse a gain the
 * stamped line would let through, unless it is a visible exception (`baselineRefusals`, scripts/verify-gate.ts, RP-1194).
 */
const HIDDEN_ASSERTS = "docs/visibility/hidden-asserts/";
const UNTESTED_SEAMS = "docs/visibility/untested-seams/";

/** A changed file's text at the merge base and at the head; undefined where it does not exist. Throws when git cannot read it. */
export type Versions = (file: string) => { before: string | undefined; after: string | undefined };

/** True for a ratchet list: a `.txt` under one of the two folders. */
const isRatchetList = (path: string) => (path.startsWith(HIDDEN_ASSERTS) || path.startsWith(UNTESTED_SEAMS)) && path.endsWith(".txt");

/**
 * A ratchet list's entries as its check reads them: one a line, blank lines and `#` lines left out; in an untested-seams
 * list a `#` comment ends the line and the ID and seam are one space apart (scripts/check-scenario-seams.ts `parseGaps`).
 */
const ratchetEntries = (path: string, text: string) =>
  text.split("\n").flatMap((raw) => {
    const line = path.startsWith(UNTESTED_SEAMS) ? raw.replace(/#.*/, "").trim().replace(/\s+/g, " ") : raw.trim();
    return line === "" || line.startsWith("#") ? [] : [line];
  });

/** What a ratchet list gains that its check would let through: an entry, or a list neither side of which could be read. */
export type RatchetGain = { file: string; entry: string };

/** Named in place of an entry when neither side of a changed list exists: nothing shows it lost one, so it counts. */
export const UNREADABLE_LIST = "(read on neither side)";

/**
 * The entries each changed ratchet list has at the head beyond the merge base (`versions`): an entry the
 * PR adds or loosens (an entry changed in place is one gone and one gained; a second copy of one counts, since each copy
 * lets one assert through). Removing entries, or the list, gains none. Throws when git cannot read a side.
 */
export function ratchetGains(changed: string[], versions: Versions): RatchetGain[] {
  return changed.filter(isRatchetList).flatMap((file) => {
    const { before, after } = versions(file);
    if (after === undefined) return before === undefined ? [{ file, entry: UNREADABLE_LIST }] : [];
    const left = new Map<string, number>();
    for (const entry of ratchetEntries(file, before ?? "")) left.set(entry, (left.get(entry) ?? 0) + 1);
    return ratchetEntries(file, after).flatMap((entry) => {
      const n = left.get(entry) ?? 0;
      left.set(entry, n - 1);
      return n > 0 ? [] : [{ file, entry }];
    });
  });
}

const isScenarioFile = (path: string) => path === matrixFile || (path.startsWith(`${scenariosDir}/`) && path.endsWith(".md"));

/**
 * The scenario IDs the changed scenario files (docs/visibility.md's matrix, docs/visibility/scenarios/*.md) hold at
 * the merge base and not at the head, by the file that held them: a removed row, or a deleted file, drops its test
 * requirement (RP-1196). The changed files are compared as one set, so a row moved from one to another loses nothing.
 */
export function lostScenarios(changed: string[], versions: Versions): { file: string; ids: string[] }[] {
  const files = changed.filter(isScenarioFile);
  const sides = files.map((file) => ({ file, ...versions(file) }));
  const idsOf = (file: string, markdown: string | undefined) => (markdown === undefined ? [] : scenarioRows([{ file, markdown }]).map((row) => row.id));
  const now = new Set(sides.flatMap(({ file, after }) => idsOf(file, after)));
  return sides.flatMap(({ file, before }) => {
    const ids = [...new Set(idsOf(file, before))].filter((id) => id !== "" && !now.has(id));
    return ids.length > 0 ? [{ file, ids }] : [];
  });
}

/**
 * A test (`*.test.*`, `*.spec.*`) or any file under a test/ folder: what CI runs, or what its tests read. Never under
 * docs/: a ratchet list is named after its test (`hidden-asserts/apps/api/test/links.test.ts.txt`), and it may go.
 */
const isTestFile = (path: string) => !path.startsWith("docs/") && (/\.(?:test|spec)\.[^/]+$/.test(path) || /(^|\/)test\//.test(path));

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The changed test files the head deletes (RP-1196): the tests they held no longer run, and CI goes green without them.
 * A test moved unchanged is not one: git lists a move as a delete and an add, so a deleted file whose name and text a
 * changed test file gains elsewhere is left out. A move with an edit counts.
 */
export function removedTests(changed: string[], versions: Versions): string[] {
  const tests = changed.filter(isTestFile).map((file) => ({ file, ...versions(file) }));
  const added = tests.filter(({ before, after }) => before === undefined && after !== undefined);
  return tests
    .filter(({ file, before, after }) => before !== undefined && after === undefined && !added.some((add) => baseName(add.file) === baseName(file) && add.after === before))
    .map(({ file }) => file);
}

/**
 * The changed paths that are CI's own: `CI_OWN_FILES`; each ratchet list that gains an entry (`ratchetGains`); each
 * scenario file that loses a scenario ID (`lostScenarios`); each test file deleted (`removedTests`); and each package.json that differs between the merge base
 * and the head (`versions`, as `pnpm queue` reads them) in more than its `version` or `description`. One it cannot
 * parse, or read on either side, counts.
 */
export function ciOwnChanges(changed: string[], versions: Versions): string[] {
  const gained = new Set(ratchetGains(changed, versions).map(({ file }) => file));
  const lost = new Map(lostScenarios(changed, versions).map(({ file, ids }) => [file, ids]));
  const removed = new Set(removedTests(changed.filter((path) => !isCiOwnFile(path)), versions));
  return changed.flatMap((path) => {
    if (isCiOwnFile(path)) return [path];
    // eslint-disable-next-line rabaed/no-avoid-terms -- a source file, git's word, not the domain's
    if (removed.has(path)) return [`${path} (deletes a test file)`];
    if (isRatchetList(path)) return gained.has(path) ? [`${path} (gains an entry)`] : [];
    if (isScenarioFile(path)) {
      const ids = lost.get(path);
      return ids === undefined ? [] : [`${path} (loses ${ids.length === 1 ? "scenario" : "scenarios"} ${ids.join(", ")})`];
    }
    if (path !== "package.json" && !path.endsWith("/package.json")) return [];
    const { before, after } = versions(path);
    const [was, now] = [ciFieldsOf(before), ciFieldsOf(after)];
    return (before === undefined && after === undefined) || was === undefined || now === undefined || was !== now ? [path] : [];
  });
}

export interface CiJob {
  name: string;
  status: string;
  conclusion: string | null;
}

/** A workflow run, with its latest jobs. */
export interface CiRun {
  id: number;
  headSha: string;
  event: string;
  /** The workflow file the run used: `.github/workflows/ci.yml`. */
  path: string;
  status: string;
  conclusion: string | null;
  /** The repository the run belongs to, and the one its head came from (undefined: a deleted fork). */
  repo: string;
  headRepo: string | undefined;
  /** The PRs the run was for (GitHub's `pull_requests`: this repo's PRs only), with the branch each merges into. */
  pulls: { number: number; baseRef: string }[];
  jobs: CiJob[];
}

/** What CI shows for a head: the ruleset's required checks and the head's runs, or the error that stopped the read. */
export type CiEvidence = { required: string[]; runs: CiRun[] } | { error: string };

export type CiVerdict = { state: "green"; runId: number } | { state: "running"; left: string[] } | { state: "refused"; reason: string };

/** The line `pnpm queue` and the checks print while CI runs. */
export const ciRunningLine = (head: string, left: string[]) => `CI still running on ${head}: ${left.length} ${left.length === 1 ? "job" : "jobs"} left (${left.join(", ")})`;

const passed = (job: CiJob | undefined) => job?.status === "completed" && job.conclusion === "success";

/** The branch a counted run's PR merges into: a run for a PR into another branch used that branch's ci.yml. */
export const MAIN_BRANCH = "main";

/** Whether CI green on `head` counts as PR `pr`'s verify; `ownChanges` is `ciOwnChanges` of the PR. */
export function ciVerdict(head: string, pr: number, ownChanges: string[], evidence: CiEvidence): CiVerdict {
  const refused = (reason: string): CiVerdict => ({ state: "refused", reason });
  // eslint-disable-next-line rabaed/no-avoid-terms -- git's files, by their own name
  if (ownChanges.length > 0) return refused(`it changes CI's own files (${ownChanges.join(", ")}), so its CI run, which used the PR's own copy of them, does not count: it needs a stamped verify line`);
  if ("error" in evidence) return refused(`could not read CI on ${head}: ${evidence.error.trim()}`);
  const required = evidence.required.filter((name) => !(name in OTHER_REQUIRED_CHECKS));
  // eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's required checks, by their own name
  if (required.length === 0) return refused("the main ruleset names no required check that ci.yml reports, so there is nothing to hold its CI run to");
  const onHead = evidence.runs.filter((run) => run.headSha === head && run.event === "pull_request" && run.path === CI_WORKFLOW);
  const fromHere = onHead.filter((run) => run.headRepo !== undefined && run.headRepo === run.repo);
  // Only a run for this PR into main: the same head opened against another branch runs that branch's ci.yml.
  const ours = fromHere.filter((run) => run.pulls.some((pull) => pull.number === pr && pull.baseRef === MAIN_BRANCH));
  if (ours.length === 0) {
    if (onHead.length === 0) return refused(`no CI (${CI_WORKFLOW}) pull_request run on its head ${head} yet`);
    if (fromHere.length === 0) return refused(`its only CI runs on ${head} are from a fork, which never count`);
    return refused(`its CI runs on ${head} are not for PR #${pr} into ${MAIN_BRANCH} (a PR into another branch runs that branch's ci.yml), so they do not count`);
  }
  const jobOf = (run: CiRun, name: string) => run.jobs.find((job) => job.name === name);
  const green = ours.find((run) => run.status === "completed" && run.conclusion === "success" && required.every((name) => passed(jobOf(run, name))));
  if (green) return { state: "green", runId: green.id };
  const running = ours.find((run) => run.status !== "completed");
  if (running) return { state: "running", left: required.filter((name) => !passed(jobOf(running, name))) };
  const [latest] = ours;
  if (latest === undefined) return refused(`no CI run on ${head}`);
  const bad = required.flatMap((name) => {
    const job = jobOf(latest, name);
    return job === undefined ? [`${name} (not in the run)`] : passed(job) ? [] : [`${name} (${job.conclusion ?? job.status})`];
  });
  return refused(`its CI run ${latest.id} on ${head} ended ${latest.conclusion ?? latest.status}${bad.length > 0 ? `: ${bad.join(", ")}` : ""}`);
}

/** How the checks read CI: the main ruleset's required checks, and the head's ci.yml pull_request runs with their jobs. */
export interface CiReads {
  requiredChecks(): Promise<string[]>;
  ciRuns(head: string): Promise<CiRun[]>;
}

const errorOf = (error: unknown): CiEvidence => ({ error: error instanceof Error ? error.message : String(error) });

/** `read`'s evidence; any error becomes `{ error }`, which `ciVerdict` refuses (for `pnpm queue`'s gh calls, which are synchronous). */
export function ciEvidenceOf(read: () => { required: string[]; runs: CiRun[] }): CiEvidence {
  try {
    return read();
  } catch (error) {
    return errorOf(error);
  }
}

/** The evidence for `head`; any error becomes `{ error }`, which `ciVerdict` refuses. */
export async function readCiEvidence(head: string, reads: CiReads): Promise<CiEvidence> {
  try {
    const required = await reads.requiredChecks();
    return { required, runs: await reads.ciRuns(head) };
  } catch (error) {
    return errorOf(error);
  }
}

const PER_PAGE = 100;

/** The API paths (under `repos/{owner}/{repo}/`) CI is read from, for the HTTP reads here and `pnpm queue`'s gh. */
export const RULES_PATH = "rules/branches/main";
export const ciRunsPath = (head: string) => `actions/workflows/${CI_WORKFLOW_FILE}/runs?head_sha=${head}&event=pull_request&per_page=${PER_PAGE}`;
export const ciJobsPath = (runId: number) => `actions/runs/${runId}/jobs?filter=latest&per_page=${PER_PAGE}`;

/** The required checks in the answer of `RULES_PATH`. */
export const requiredFromRules = (answer: unknown): string[] =>
  (answer as { type: string; parameters?: { required_status_checks?: { context: string }[] } }[])
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check.context));

interface RawRun {
  id: number;
  head_sha: string;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  repository: { full_name: string };
  head_repository: { full_name: string } | null;
  pull_requests?: { number: number; base: { ref: string } }[];
}

/** The runs in the answer of `ciRunsPath`. */
export const runsFrom = (answer: unknown): RawRun[] => (answer as { workflow_runs: RawRun[] }).workflow_runs;

/** A run from `runsFrom` with the answer of its `ciJobsPath`; throws when the jobs did not fit on one page. */
export function ciRunFrom(run: RawRun, jobsAnswer: unknown): CiRun {
  const { total_count: total, jobs } = jobsAnswer as { total_count: number; jobs: CiJob[] };
  // One page holds every job ci.yml has; more would mean jobs this read never saw.
  if (total > jobs.length) throw new Error(`run ${run.id} has ${total} jobs, more than one page of ${PER_PAGE}`);
  return {
    id: run.id,
    headSha: run.head_sha,
    event: run.event,
    path: run.path,
    status: run.status,
    conclusion: run.conclusion,
    repo: run.repository.full_name,
    headRepo: run.head_repository?.full_name,
    pulls: (run.pull_requests ?? []).map((pull) => ({ number: pull.number, baseRef: pull.base.ref })),
    jobs: jobs.map(({ name, status, conclusion }) => ({ name, status, conclusion })),
  };
}

/** `CiReads` over GitHub's REST API with the workflow's token (needs `actions: read`). */
export function ciOverHttp(repository: string, token: string, fetcher: typeof fetch = fetch): CiReads {
  const get = async (path: string): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub GET ${path} answered ${response.status}`);
    return response.json();
  };
  return {
    requiredChecks: async () => requiredFromRules(await get(RULES_PATH)),
    async ciRuns(head) {
      const all: CiRun[] = [];
      for (const run of runsFrom(await get(ciRunsPath(head)))) all.push(ciRunFrom(run, await get(ciJobsPath(run.id))));
      return all;
    },
  };
}
