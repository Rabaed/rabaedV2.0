import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CI_WORKFLOW,
  ciOverHttp,
  ciOwnChanges,
  ciRunningLine,
  ciVerdict,
  isCiOwnFile,
  OTHER_REQUIRED_CHECKS,
  readCiEvidence,
  type CiEvidence,
  type CiRun,
} from "./ci-green.ts";
import type { ReviewedGit } from "./reviewed-label.ts";
import { stampLine, verifiedOrGreen } from "./verify-gate.ts";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const REPO = "Rabaed/rabaedV2.0";
const PR = 42;
// The main ruleset's required checks, as `rules/branches/main` named them on 2026-10-31.
const RULESET = [
  "seam 1 (API as a Member)",
  "seam 2 (database RLS)",
  "lint",
  "typecheck",
  "story tests (behaviour, axe, screenshots)",
  "unit",
  "infra (template assertions)",
  "mail (mailer against the catcher)",
  "web-build",
  "web image starts",
  "gitleaks",
  "migrations immutable",
  "verify-gate",
  "reviewed-required",
];
const CI_JOBS = RULESET.filter((name) => !(name in OTHER_REQUIRED_CHECKS));

const run = (overrides: Partial<CiRun> = {}): CiRun => ({
  id: 9001,
  headSha: HEAD,
  event: "pull_request",
  path: CI_WORKFLOW,
  status: "completed",
  conclusion: "success",
  repo: REPO,
  headRepo: REPO,
  pulls: [{ number: PR, baseRef: "main" }],
  jobs: [...CI_JOBS, "docs-only decision", "seam 1 (shard 1/4)"].map((name) => ({ name, status: "completed", conclusion: "success" })),
  ...overrides,
});
const withJob = (name: string, job: { status: string; conclusion: string | null }) => run({ jobs: run().jobs.map((each) => (each.name === name ? { name, ...job } : each)) });
const evidence = (...runs: CiRun[]): CiEvidence => ({ required: RULESET, runs });

describe("ciVerdict", () => {
  it("is green when a finished pull_request run of ci.yml on the exact head passed every required job", () => {
    expect(ciVerdict(HEAD, PR, [], evidence(run()))).toEqual({ state: "green", runId: 9001 });
  });

  it("refuses a PR that changes CI's own files, however green its run: the run used the PR's own copy", () => {
    const verdict = ciVerdict(HEAD, PR, [".github/workflows/ci.yml"], evidence(run()));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toMatch(/\.github\/workflows\/ci\.yml.*stamped/);
  });

  it("is running while the head's run is not finished, naming the required jobs left", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence(run({ status: "in_progress", conclusion: null, jobs: [{ name: "lint", status: "completed", conclusion: "success" }, { name: "unit", status: "in_progress", conclusion: null }] })));
    expect(verdict.state).toBe("running");
    if (verdict.state === "running") {
      expect(verdict.left).toContain("unit");
      // Not started yet counts as left too.
      expect(verdict.left).toContain("seam 2 (database RLS)");
      expect(verdict.left).not.toContain("lint");
      expect(verdict.left).toHaveLength(CI_JOBS.length - 1);
    }
  });

  it("refuses a run whose required job failed, naming it", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence({ ...withJob("unit", { status: "completed", conclusion: "failure" }), conclusion: "failure" }));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("unit (failure)");
  });

  it("refuses a run whose conclusion is not success, even with every required job green (a check that is not required failed)", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence(run({ conclusion: "failure" })));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("failure");
  });

  it("refuses a skipped required job: a docs-only decision or an `if:` made it report success without running", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence(withJob("story tests (behaviour, axe, screenshots)", { status: "completed", conclusion: "skipped" })));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("story tests (behaviour, axe, screenshots) (skipped)");
  });

  it("refuses a run that lacks a required job (renamed or removed), naming it", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence(run({ jobs: run().jobs.filter((job) => job.name !== "mail (mailer against the catcher)") })));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("mail (mailer against the catcher) (not in the run)");
  });

  it("refuses a fork's run: CI there ran code GitHub did not run as this repo", () => {
    const verdict = ciVerdict(HEAD, PR, [], evidence(run({ headRepo: "stranger/rabaedV2.0" })));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toMatch(/fork/);
  });

  it("refuses a run for the same head opened as another PR, or into another branch: that run used the other branch's ci.yml", () => {
    for (const pulls of [[{ number: 43, baseRef: "main" }], [{ number: PR, baseRef: "weak" }], []]) {
      const verdict = ciVerdict(HEAD, PR, [], evidence(run({ pulls })));
      expect(verdict.state).toBe("refused");
      if (verdict.state === "refused") expect(verdict.reason).toContain(`not for PR #${PR} into main`);
    }
    expect(ciVerdict(HEAD, PR, [], evidence(run({ id: 1, pulls: [{ number: 43, baseRef: "weak" }] }), run({ id: 2 })))).toEqual({ state: "green", runId: 2 });
  });

  it("refuses a run with no head repository (a deleted fork)", () => {
    expect(ciVerdict(HEAD, PR, [], evidence(run({ headRepo: undefined }))).state).toBe("refused");
  });

  it("does not count a run on another commit, another event or another workflow file", () => {
    for (const other of [run({ headSha: OTHER }), run({ headSha: HEAD.slice(0, 7) }), run({ event: "push" }), run({ event: "merge_group" }), run({ path: ".github/workflows/other.yml" })]) {
      const verdict = ciVerdict(HEAD, PR, [], evidence(other));
      expect(verdict.state).toBe("refused");
      if (verdict.state === "refused") expect(verdict.reason).toContain(HEAD);
    }
  });

  it("is green when any finished run on the head passed: a later run cancelled by a re-trigger does not void it", () => {
    expect(ciVerdict(HEAD, PR, [], evidence(run({ id: 2, conclusion: "cancelled" }), run({ id: 1 })))).toEqual({ state: "green", runId: 1 });
  });

  it("refuses on an API error, naming it", () => {
    const verdict = ciVerdict(HEAD, PR, [], { error: "GitHub GET actions/workflows/ci.yml/runs answered 502" });
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("502");
  });

  it("refuses when the ruleset names no required check or only checks from other workflows: nothing to hold CI to", () => {
    expect(ciVerdict(HEAD, PR, [], { required: [], runs: [run()] }).state).toBe("refused");
    expect(ciVerdict(HEAD, PR, [], { required: ["verify-gate", "gitleaks"], runs: [run()] }).state).toBe("refused");
  });

  it("does not wait on the required checks other workflows report (verify-gate itself, reviewed-required, gitleaks)", () => {
    expect(ciVerdict(HEAD, PR, [], evidence(run({ jobs: run().jobs.filter((job) => !(job.name in OTHER_REQUIRED_CHECKS)) }))).state).toBe("green");
  });
});

describe("ciRunningLine", () => {
  it("says CI is still running on the head and how many jobs are left", () => {
    expect(ciRunningLine(HEAD, ["unit", "lint"])).toBe(`CI still running on ${HEAD}: 2 jobs left (unit, lint)`);
    expect(ciRunningLine(HEAD, ["unit"])).toBe(`CI still running on ${HEAD}: 1 job left (unit)`);
  });
});

describe("isCiOwnFile", () => {
  it("names CI's workflow, its actions, every vitest or vite or playwright config, and the scripts CI runs", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/actions/test-timing/action.yml",
      "vitest.config.ts",
      "packages/ui/vitest.config.ts",
      "apps/web/vitest.workspace.mjs",
      "packages/x/vite.config.ts",
      "apps/web/playwright.config.ts",
      "eslint.config.js",
      "packages/eslint-plugin/src/rules/no-avoid-terms.ts",
      "tsconfig.base.json",
      "apps/api/tsconfig.json",
      "packages/ui/.storybook/preview.tsx",
      "pnpm-lock.yaml",
      "scripts/docs-only.ts",
      "scripts/test-services.ts",
      "packages/db/test-support/global-setup.ts",
    ])
      expect(isCiOwnFile(path), path).toBe(true);
  });

  it("leaves app code, tests, test data and other workflows alone", () => {
    for (const path of [
      "apps/api/src/app.ts",
      "apps/worker/src/record/golden-fixtures.ts",
      "scripts/queue-pr.ts",
      "apps/api/test/links.test.ts",
      "packages/ui/test/stories.test.tsx",
      "apps/api/test/fixtures/registers/formats.xlsx",
      ".github/workflows/deploy-uat.yml",
      "docs/visibility.md",
      "my-vitest.config.ts.md",
      "apps/api/src/latest/support.ts",
    ])
      expect(isCiOwnFile(path), path).toBe(false);
  });

  it("names the workflows that judge a PR: the gate's own and every one that reports a required check (RP-1194)", () => {
    for (const path of [
      ".github/workflows/verify-gate.yml",
      ".github/workflows/reviewed-add.yml",
      ".github/workflows/reviewed-label.yml",
      ".github/workflows/reviewed-required.yml",
      ".github/workflows/secret-scan.yml",
      ".github/workflows/dependency-audit.yml",
      ".github/workflows/update-screenshots.yml",
    ])
      expect(isCiOwnFile(path), path).toBe(true);
    for (const path of [".github/workflows/jira-close.yml", ".github/workflows/queue-drop-comment.yml", ".github/workflows/deploy-records-uat.yml", ".github/workflows/age-uat.yml"])
      expect(isCiOwnFile(path), path).toBe(false);
  });

  it("names the image CI's 'web image starts' job builds", () => {
    for (const path of ["Dockerfile", ".dockerignore", "apps/web/Dockerfile"]) expect(isCiOwnFile(path), path).toBe(true);
  });

  it("names the shared test helpers: a helper that returns early turns every test using it green", () => {
    for (const path of [
      "packages/db/test-support/hidden-from.ts",
      "packages/db/test-support/id-sweep.ts",
      "apps/api/test/support/harness.ts",
      "apps/api/test/support/tower.ts",
      "apps/admin/test/support/harness.ts",
      "packages/domain/test/support/mar-workflow.ts",
      "packages/infra/test/support.ts",
      "packages/db/test/uat-tool-support.ts",
      "packages/db/test/outbox-crash-worker.ts",
      "scripts/check-migration-drift.fixtures.ts",
    ])
      expect(isCiOwnFile(path), path).toBe(true);
  });

  it("names the repo-wide checks unit tests run against the real repo: they judge, they are not code under test", () => {
    for (const path of ["scripts/check-scenario-ids.ts", "scripts/check-leak-channels.ts", "scripts/check-hidden-asserts.ts"]) expect(isCiOwnFile(path), path).toBe(true);
  });
});

describe("a PR that weakens expectHiddenFrom", () => {
  it("gets no CI credit: every visibility scenario would pass with it returning early", () => {
    const ownChanged = ciOwnChanges(["packages/db/test-support/hidden-from.ts", "apps/api/src/app.ts"], () => ({ before: undefined, after: undefined }));
    expect(ownChanged).toEqual(["packages/db/test-support/hidden-from.ts"]);
    const verdict = ciVerdict(HEAD, PR, ownChanged, evidence(run()));
    expect(verdict.state).toBe("refused");
    if (verdict.state === "refused") expect(verdict.reason).toContain("packages/db/test-support/hidden-from.ts");
  });
});

/**
 * Files outside src/ that tests import as the code they test, not as helpers: a change to one is what CI tests.
 * A new import outside src/ fails the test below until it is named here or is CI's own. apps/admin/web/ is the admin
 * app's front end, which its vite.config builds.
 */
const CODE_UNDER_TEST = ["packages/db/dev-tools/", "apps/web/next.config.ts", "scripts/screens-examples/", "scripts/uat-sheet/", "apps/admin/web/"];

/** Tests whose code samples hold import lines that name no real file (lint rules' tests). */
const SAMPLES = ["packages/eslint-plugin/src/rules.test.ts", "scripts/ci-green.test.ts", "scripts/uat-imports.test.ts"];

/** A view of the repo's files: the real checkout, or a planted one in a test. `paths` are the tracked files. */
type Files = { paths: readonly string[]; isFile: (path: string) => boolean; read: (path: string) => string; packages: readonly Workspace[] };
/** A package.json: the root's (`dir` "."), or a workspace package's. */
type Workspace = { dir: string; name: string; exports?: Record<string, string>; scripts?: Record<string, string> };

const CHECKOUT: Files = {
  paths: spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" }).stdout.split("\0").filter(Boolean),
  isFile: (path) => existsSync(path) && !statSync(path).isDirectory(),
  read: (path) => readFileSync(path, "utf8"),
  packages: [
    { ...(JSON.parse(readFileSync("package.json", "utf8")) as Workspace), dir: "." },
    ...["apps", "packages"].flatMap((root) =>
      spawnSync("git", ["ls-files", "--", `${root}/*/package.json`], { encoding: "utf8" })
        .stdout.split("\n")
        .filter(Boolean)
        .map((file) => ({ ...(JSON.parse(readFileSync(file, "utf8")) as Workspace), dir: posix.dirname(file) })),
    ),
  ],
};

// `from "x"` (one line or several), `import "x"`, `import("x")`, `vi.mock("x")`, `require("x")`, either quote.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bvi\.mock\(\s*|\brequire\(\s*)(["'])([^"'\n]+)\1/g;

const isTest = (path: string) => /\.test\.[cm]?[jt]sx?$/.test(path);
const isCode = (path: string) => /\.[cm]?[jt]sx?$/.test(path);
/** App code: what CI tests and review reads, never CI's own (under src/, or `CODE_UNDER_TEST`). */
const isCodeUnderTest = (path: string) => /(^|\/)src\//.test(path) || CODE_UNDER_TEST.some((prefix) => path.startsWith(prefix));

/**
 * A relative import, or a workspace package's own (`@rabaed/<name>[/<sub>]`, by its `exports` map as pnpm resolves
 * it); undefined for any other package. Reports one of ours it cannot find, so nothing slips past unread.
 */
const resolverFor = (files: Files, onUnresolved: (entry: string) => void) => {
  const asFile = (base: string) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((path) => files.isFile(path));
  return (from: string, specifier: string): string | undefined => {
    if (specifier.startsWith(".")) {
      const found = asFile(posix.normalize(posix.join(posix.dirname(from), specifier)));
      // Not a file: an import line inside a code sample (a lint rule's test); `SAMPLES` names where that is expected.
      if (found === undefined) onUnresolved(`${from}: "${specifier}"`);
      return found;
    }
    const workspace = files.packages.find((each) => specifier === each.name || specifier.startsWith(`${each.name}/`));
    if (workspace === undefined) return undefined;
    const sub = `.${specifier.slice(workspace.name.length)}`;
    const target = workspace.exports?.[sub] ?? (sub === "." ? undefined : sub);
    const found = target === undefined ? asFile(`${workspace.dir}/src/index`) : asFile(posix.join(workspace.dir, target));
    if (found === undefined) onUnresolved(`${from}: "${specifier}"`);
    return found;
  };
};

/** The events on which a workflow judges a PR: its run is part of what counts as green. Deploys and manual jobs are not. */
const PR_EVENTS = ["pull_request", "pull_request_target", "merge_group"];
/** A PR's activity types that come after the verdict: a workflow on only these (jira-close, queue-drop-comment) judges nothing. */
const AFTER_VERDICT = ["closed", "dequeued"];
const judgesPrs = (on: unknown): boolean => {
  if (typeof on === "string") return PR_EVENTS.includes(on);
  if (Array.isArray(on)) return on.some((event) => PR_EVENTS.includes(String(event)));
  return Object.entries((on ?? {}) as Record<string, { types?: unknown } | null>).some(([event, config]) => {
    if (!PR_EVENTS.includes(event)) return false;
    const types = config?.types;
    return !Array.isArray(types) || types.some((type) => !AFTER_VERDICT.includes(String(type)));
  });
};
const TEST_CONFIG = /(^|\/)(vitest\.config|vitest\.workspace|vite\.config|playwright\.config)\.[^/]+$|(^|\/)\.storybook\//;
/** A file path in a command or a config's strings: `scripts/x.ts`, `./setup.ts`, `../../scripts/x-reporter.ts`. */
const PATH_TOKEN = /(?:\.{1,2}\/)*[\w@-][\w.@-]*(?:\/[\w.@-]+)*\.(?:[cm]?[jt]sx?|sh)(?![\w/])/g;
/** `pnpm …` or the repo's wrapper `node scripts/pnpm.ts …`, up to the next shell operator. */
const PNPM = /(?:\bpnpm|\bscripts\/pnpm\.ts)((?:[ \t]+[^\s|&;]+)*)/g;
/** What `pnpm install` runs in every package. */
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare"];

const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value !== null && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

/**
 * The files that decide what counts as green and that `isCiOwnFile` misses: every PR-facing workflow file, every file it (or its
 * local action) runs, with the package.json scripts its `pnpm` calls run; every test config and what it loads by name
 * (setup files, global setups, reporters); every file already CI's own (the helpers, the checks); and what each of
 * them imports, all the way down. Imports reach workspace packages too, by their `exports`, but stop at app code
 * (`isCodeUnderTest`): CI tests that, it does not judge with it. node_modules is not followed.
 */
const ciOwnGaps = (files: Files): string[] => {
  const roots = new Set<string>();
  const add = (path: string) => {
    if (!isCodeUnderTest(path) && !isTest(path)) roots.add(path);
  };
  // A file a command or config names, from its own folder or from the repo's root (`trusted/scripts/x.ts` is main's copy).
  const named = (dir: string, text: string) => {
    for (const [token] of text.matchAll(PATH_TOKEN)) {
      const parts = token.split("/");
      const found = [posix.normalize(posix.join(dir, token)), ...parts.map((_, at) => parts.slice(at).join("/"))].find((path) => files.isFile(path));
      if (found !== undefined) add(found);
    }
  };
  const root = files.packages.filter((pkg) => pkg.dir === ".");
  const workspaces = files.packages.filter((pkg) => pkg.dir !== ".");
  const ran = new Set<string>();
  const runScript = (packages: readonly Workspace[], name: string) => {
    for (const pkg of packages) {
      const command = pkg.scripts?.[name];
      if (command === undefined || ran.has(`${pkg.dir} ${name}`)) continue;
      ran.add(`${pkg.dir} ${name}`);
      commands(pkg.dir, command);
    }
  };
  const commands = (dir: string, text: string) => {
    named(dir, text);
    for (const [, args = ""] of text.matchAll(PNPM)) {
      const tokens = args.trim().split(/\s+/);
      const filters: string[] = [];
      let recursive = false;
      let name: string | undefined;
      for (let at = 0; at < tokens.length && name === undefined; at++) {
        const token = tokens[at] ?? "";
        if (token === "--filter" || token === "-F") filters.push(tokens[++at] ?? "");
        else if (token.startsWith("--filter=")) filters.push(token.slice("--filter=".length));
        else if (token === "-r" || token === "--recursive") recursive = true;
        else if (token !== "run" && token !== "" && !token.startsWith("-")) name = token;
      }
      if (name === "install" || name === "i") for (const life of LIFECYCLE) runScript(files.packages, life);
      else if (name !== undefined) runScript(filters.length > 0 ? workspaces.filter((pkg) => filters.includes(pkg.name)) : recursive ? workspaces : root, name);
    }
  };
  const steps = (value: unknown) => {
    for (const text of stringsIn(value)) {
      const action = text.startsWith("./") ? `${text.slice(2)}/action.yml` : undefined;
      if (action !== undefined && files.isFile(action)) {
        add(action);
        steps((parse(files.read(action)) as { runs?: unknown }).runs);
      } else commands(".", text);
    }
  };
  for (const path of files.paths) {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
      const workflow = parse(files.read(path)) as { on?: unknown; jobs?: unknown };
      // The workflow file too: a PR's run of it uses the PR's own copy (RP-1194).
      if (judgesPrs(workflow.on)) {
        roots.add(path);
        steps(workflow.jobs);
      }
    } else if (TEST_CONFIG.test(path)) {
      add(path);
      named(posix.dirname(path), files.read(path));
    } else if (isCode(path) && isCiOwnFile(path)) add(path);
  }
  const resolve = resolverFor(files, () => undefined);
  const seen = new Set<string>();
  const queue = [...roots];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!isCode(path)) continue;
    for (const [, , specifier = ""] of files.read(path).matchAll(SPECIFIER)) {
      const target = resolve(path, specifier);
      if (target !== undefined && isCode(target) && !isTest(target) && !isCodeUnderTest(target)) queue.push(target);
    }
  }
  return [...seen].filter((path) => !isCiOwnFile(path)).sort();
};

describe("every helper a test imports", () => {
  const tracked = spawnSync("git", ["ls-files", "-z", "--", "*.test.ts", "*.test.tsx"], { encoding: "utf8" }).stdout.split("\0").filter(Boolean);
  const unresolved = new Set<string>();
  const resolve = resolverFor(CHECKOUT, (entry) => unresolved.add(entry));

  it("reads every import form", () => {
    const text = `import a from "./a.ts";\nimport {\n  b,\n} from './b.ts';\nimport "./c.ts";\nawait import("./d.ts");\nvi.mock("./e.ts");\nrequire("./f.ts");`;
    expect([...text.matchAll(SPECIFIER)].map(([, , specifier]) => specifier)).toEqual(["./a.ts", "./b.ts", "./c.ts", "./d.ts", "./e.ts", "./f.ts"]);
  });

  // A scripts/ file a test imports is the code under test, as src/ is; its fixtures and the checks are not.
  it("is CI's own, unless it is code under test (under src/, or a scripts/ file) or another test", () => {
    expect(tracked.length).toBeGreaterThan(100);
    const missing = new Set<string>();
    for (const file of tracked) {
      for (const [, , specifier = ""] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        const path = resolve(file, specifier);
        if (path === undefined || isTest(path) || !isCode(path) || isCodeUnderTest(path) || isCiOwnFile(path)) continue;
        if (/^scripts\/[^/]+\.ts$/.test(path)) continue;
        missing.add(`${path} (imported by ${file})`);
      }
    }
    expect([...missing]).toEqual([]);
    expect([...unresolved].filter((entry) => !SAMPLES.some((file) => entry.startsWith(`${file}:`)))).toEqual([]);
  });
});

describe("ciOwnChanges", () => {
  const versions = (before: unknown, after: unknown) => () => ({ before: before === undefined ? undefined : JSON.stringify(before), after: after === undefined ? undefined : JSON.stringify(after) });

  it("lists the changed files that are CI's own", () => {
    expect(ciOwnChanges(["apps/api/src/a.ts", ".github/workflows/ci.yml", "vitest.config.ts"], versions(undefined, undefined))).toEqual([".github/workflows/ci.yml", "vitest.config.ts"]);
  });

  it("counts a package.json whose scripts, dependencies, overrides or package manager changed", () => {
    expect(ciOwnChanges(["package.json"], versions({ scripts: { "test:unit": "vitest run --project unit" } }, { scripts: { "test:unit": "true" } }))).toEqual(["package.json"]);
    expect(ciOwnChanges(["apps/web/package.json"], versions({ devDependencies: { vitest: "^5.0.5" } }, { devDependencies: { vitest: "npm:always-pass@1" } }))).toEqual(["apps/web/package.json"]);
    expect(ciOwnChanges(["package.json"], versions({ pnpm: { overrides: {} } }, { pnpm: { overrides: { vitest: "npm:always-pass@1" } } }))).toEqual(["package.json"]);
    expect(ciOwnChanges(["package.json"], versions({ packageManager: "pnpm@10.34.5" }, { packageManager: "pnpm@10.0.0" }))).toEqual(["package.json"]);
  });

  it("leaves a package.json alone when only its version or description changed", () => {
    expect(ciOwnChanges(["packages/ui/package.json"], versions({ name: "@rabaed/ui", version: "1.0.0", description: "a" }, { name: "@rabaed/ui", version: "1.1.0", description: "b" }))).toEqual([]);
  });

  it("counts a hidden-asserts or untested-seams list that gains an entry: it lets a weaker test through, and the check reads the PR's own list", () => {
    const list = (...entries: string[]) => `# comment\n${entries.map((entry) => `${entry}\n`).join("")}`;
    const hidden = "docs/visibility/hidden-asserts/apps/api/test/links.test.ts.txt";
    const gaps = "docs/visibility/untested-seams/RP-412.txt";
    const at = (before: string | undefined, after: string | undefined) => () => ({ before, after });
    expect(ciOwnChanges([hidden], at(list("empty a :: x"), list("empty a :: x", "text b :: y")))).toEqual([`${hidden} (gains an entry)`]);
    expect(ciOwnChanges([gaps], at(undefined, list("RP-412-1 api")))).toEqual([`${gaps} (gains an entry)`]);
    // An entry changed in place is one gone and one gained.
    expect(ciOwnChanges([gaps], at(list("RP-412-1 api"), list("RP-412-1 db")))).toEqual([`${gaps} (gains an entry)`]);
    expect(ciOwnChanges([gaps], at(undefined, undefined))).toEqual([`${gaps} (gains an entry)`]);
    // A second copy lets a second assert through (RP-1194); a comment or spacing added to a gap line is no new gap.
    expect(ciOwnChanges([hidden], at(list("empty a :: x"), list("empty a :: x", "empty a :: x")))).toEqual([`${hidden} (gains an entry)`]);
    expect(ciOwnChanges([gaps], at(list("RP-412-1 api"), list("RP-412-1  api # since RP-1134")))).toEqual([]);
  });

  it("leaves a list that only shrinks or is deleted alone, and its README", () => {
    const hidden = "docs/visibility/hidden-asserts/apps/api/test/links.test.ts.txt";
    expect(ciOwnChanges([hidden], () => ({ before: "empty a :: x\ntext b :: y\n", after: "# fixed b\nempty a :: x\n" }))).toEqual([]);
    expect(ciOwnChanges([hidden], () => ({ before: "empty a :: x\n", after: undefined }))).toEqual([]);
    expect(ciOwnChanges(["docs/visibility/hidden-asserts/README.md"], () => ({ before: "a", after: "b" }))).toEqual([]);
  });

  describe("scenario rows only grow (RP-1196)", () => {
    const table = (...ids: string[]) => `| # | Scenario | Who | Expected |\n|---|---|---|---|\n${ids.map((id) => `| ${id} | s | w | e |\n`).join("")}`;
    const matrix = (...ids: string[]) => `# Visibility\n\n## Scenario matrix\n\n${table(...ids)}\n## Next\n\n${table("99")}`;
    const ticket = "docs/visibility/scenarios/RP-412.md";
    const files = (sides: Record<string, [string | undefined, string | undefined]>) => (file: string) => {
      const [before, after] = sides[file] ?? [undefined, undefined];
      return { before, after };
    };

    it("counts a scenario file that loses a row, naming the lost ID", () => {
      const sides = files({ [ticket]: [`# RP-412 scenarios\n\n${table("RP-412-1", "RP-412-2")}`, `# RP-412 scenarios\n\n${table("RP-412-1")}`] });
      expect(ciOwnChanges([ticket], sides)).toEqual([`${ticket} (loses scenario RP-412-2)`]);
    });

    it("counts a numbered matrix row removed from docs/visibility.md", () => {
      const sides = files({ "docs/visibility.md": [matrix("1", "2", "3"), matrix("1", "3")] });
      expect(ciOwnChanges(["docs/visibility.md"], sides)).toEqual(["docs/visibility.md (loses scenario 2)"]);
    });

    it("counts a deleted scenario file, naming every ID it held", () => {
      const sides = files({ [ticket]: [`# RP-412 scenarios\n\n${table("RP-412-1", "RP-412-2")}`, undefined] });
      expect(ciOwnChanges([ticket], sides)).toEqual([`${ticket} (loses scenarios RP-412-1, RP-412-2)`]);
    });

    it("leaves a file that only gains rows, or a new file, alone", () => {
      const sides = files({
        [ticket]: [`# RP-412 scenarios\n\n${table("RP-412-1")}`, `# RP-412 scenarios\n\n${table("RP-412-1", "RP-412-2")}`],
        "docs/visibility/scenarios/RP-500.md": [undefined, `# RP-500 scenarios\n\n${table("RP-500-1")}`],
        "docs/visibility.md": [matrix("1", "2"), `${matrix("1", "2")}\nMore prose.\n`],
      });
      expect(ciOwnChanges([ticket, "docs/visibility/scenarios/RP-500.md", "docs/visibility.md"], sides)).toEqual([]);
    });

    it("leaves a row moved from one changed scenario file to another alone", () => {
      const sides = files({
        "docs/visibility.md": [matrix("1", "RP-500-1"), matrix("1")],
        "docs/visibility/scenarios/RP-500.md": [undefined, `# RP-500 scenarios\n\n${table("RP-500-1")}`],
      });
      expect(ciOwnChanges(["docs/visibility.md", "docs/visibility/scenarios/RP-500.md"], sides)).toEqual([]);
    });
  });

  describe("a deleted test file (RP-1196)", () => {
    const sides = (tree: Record<string, [string | undefined, string | undefined]>) => (file: string) => {
      const [before, after] = tree[file] ?? [undefined, undefined];
      return { before, after };
    };

    it("counts a deleted test, spec or file under a test/ folder: the tests it held no longer run", () => {
      const gone = ["apps/api/test/links.test.ts", "packages/ui/src/button.spec.tsx", "apps/api/test/fixtures/registers/formats.xlsx", "packages/ui/test/stories.test.tsx"];
      const versions = sides(Object.fromEntries(gone.map((file) => [file, ["it('a', () => {});\n", undefined]])));
      expect(ciOwnChanges(gone, versions)).toEqual(gone.map((file) => `${file} (deletes a test file)`));
    });

    it("leaves a test that is added or edited alone, and a deleted file that is no test", () => {
      const versions = sides({
        "apps/api/test/new.test.ts": [undefined, "x"],
        "apps/api/test/links.test.ts": ["x", "y"],
        "apps/api/src/old.ts": ["x", undefined],
        "docs/latest.md": ["x", undefined],
      });
      expect(ciOwnChanges(["apps/api/test/new.test.ts", "apps/api/test/links.test.ts", "apps/api/src/old.ts", "docs/latest.md"], versions)).toEqual([]);
    });

    it("leaves a test moved unchanged alone (git lists a delete and an add), but counts one moved and edited", () => {
      const versions = sides({
        "apps/api/test/links.test.ts": ["it('a', () => {});\n", undefined],
        "apps/api/test/links/links.test.ts": [undefined, "it('a', () => {});\n"],
        "apps/api/test/gone.test.ts": ["it('a', () => {});\nit('b', () => {});\n", undefined],
        "apps/api/test/moved/gone.test.ts": [undefined, "it('a', () => {});\n"],
      });
      const changed = ["apps/api/test/links.test.ts", "apps/api/test/links/links.test.ts", "apps/api/test/gone.test.ts", "apps/api/test/moved/gone.test.ts"];
      expect(ciOwnChanges(changed, versions)).toEqual(["apps/api/test/gone.test.ts (deletes a test file)"]);
    });
  });

  it("counts a new package.json, one it cannot parse, and one it could read on neither side", () => {
    expect(ciOwnChanges(["packages/new/package.json"], versions(undefined, { scripts: { postinstall: "node x.js" } }))).toEqual(["packages/new/package.json"]);
    expect(ciOwnChanges(["package.json"], () => ({ before: "{", after: "{}" }))).toEqual(["package.json"]);
    expect(ciOwnChanges(["package.json"], () => ({ before: undefined, after: undefined }))).toEqual(["package.json"]);
  });
});

describe("CI_OWN_FILES", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  /** A planted checkout: its own files and package.json scripts, the real `isCiOwnFile` judging them. */
  const planted = (tree: Record<string, string>, packages: Workspace[] = []): Files => ({ paths: Object.keys(tree), isFile: (path) => path in tree, read: (path) => tree[path] ?? "", packages });
  const workflow = (on: string, run: string) => `on: ${on}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;

  it("finds a file a PR's workflow runs, a root script it calls, or what they import, that the list misses", () => {
    const files = planted(
      {
        ".github/workflows/gate.yml": workflow("pull_request", "node scripts/gate-run.ts && pnpm -s gate"),
        "scripts/gate-run.ts": `import { rule } from "./gate-rule.ts";\nimport { app } from "../apps/api/src/app.ts";`,
        "scripts/gate-rule.ts": `import "vitest";`,
        "scripts/gate-cli.ts": "",
        "apps/api/src/app.ts": "",
      },
      [{ dir: ".", name: "root", scripts: { gate: "node scripts/gate-cli.ts" } }],
    );
    expect(ciOwnGaps(files)).toEqual([".github/workflows/gate.yml", "scripts/gate-cli.ts", "scripts/gate-rule.ts", "scripts/gate-run.ts"]);
  });

  it("finds the PR-facing workflow file itself: a PR that edits one judges itself with its own copy (RP-1194)", () => {
    const files = planted({
      ".github/workflows/gate.yml": workflow("{ pull_request_target: { types: [opened] } }", "echo ok"),
      ".github/workflows/queue.yml": workflow("merge_group", "echo ok"),
      ".github/workflows/deploy.yml": workflow("workflow_dispatch", "echo ok"),
    });
    expect(ciOwnGaps(files)).toEqual([".github/workflows/gate.yml", ".github/workflows/queue.yml"]);
  });

  it("leaves a workflow alone that judges no PR (a deploy, a manual job)", () => {
    const files = planted({ ".github/workflows/deploy.yml": workflow("{ push: { branches: [main] }, workflow_dispatch: null }", "node scripts/deploy-run.ts"), "scripts/deploy-run.ts": "" });
    expect(ciOwnGaps(files)).toEqual([]);
  });

  it("leaves a workflow alone that runs only once the verdict is in (a closed or dequeued PR)", () => {
    const files = planted({
      ".github/workflows/close.yml": workflow("{ pull_request: { types: [closed] } }", "node scripts/close-run.ts"),
      ".github/workflows/drop.yml": workflow("{ pull_request: { types: [dequeued] } }", "node scripts/drop-run.ts"),
      ".github/workflows/label.yml": workflow("{ pull_request: { types: [closed, labeled] } }", "node scripts/label-run.ts"),
      "scripts/close-run.ts": "",
      "scripts/drop-run.ts": "",
      "scripts/label-run.ts": "",
    });
    expect(ciOwnGaps(files)).toEqual([".github/workflows/label.yml", "scripts/label-run.ts"]);
  });

  it("finds what a test config loads by name (setup files, reporters) and what a helper imports", () => {
    const files = planted({
      "apps/x/vitest.config.ts": `export default { test: { setupFiles: ["./test-setup.ts"], reporters: ["../../scripts/x-reporter.ts"] } };`,
      "apps/x/test-setup.ts": "",
      "scripts/x-reporter.ts": "",
      "apps/x/test/support/harness.ts": `import { seed } from "../../seed/rows.ts";`,
      "apps/x/seed/rows.ts": "",
    });
    expect(ciOwnGaps(files)).toEqual(["apps/x/seed/rows.ts", "apps/x/test-setup.ts", "scripts/x-reporter.ts"]);
  });

  it("names every file the PR-facing workflows run, the test configs load and the helpers import, all the way down", () => {
    expect(CHECKOUT.paths).toContain(".github/workflows/verify-gate.yml");
    expect(ciOwnGaps(CHECKOUT)).toEqual([]);
  });

  it("knows which workflow reports each required check that is not a ci.yml job", () => {
    const ciJobs = Object.values((parse(ci) as { jobs: Record<string, { name?: string }> }).jobs).map((job) => job.name);
    for (const [check, workflow] of Object.entries(OTHER_REQUIRED_CHECKS)) {
      const jobs = (parse(readFileSync(workflow, "utf8")) as { jobs: Record<string, { name?: string }> }).jobs;
      expect(Object.entries(jobs).some(([key, job]) => (job.name ?? key) === check), `${check} in ${workflow}`).toBe(true);
      expect(ciJobs).not.toContain(check);
    }
  });
});

describe("verifiedOrGreen", () => {
  const git: ReviewedGit = {
    parents: () => [],
    onMain: () => false,
    tree: () => "tree1",
    mergedTree: () => "tree1",
    identity: () => ({ author: "dev@example.com", committer: "dev@example.com" }),
    changedPaths: () => ["apps/web/src/page.tsx"],
  };
  const stamped = stampLine(`pnpm verify passed on ${HEAD.slice(0, 9)}: lint, typecheck, test:unit.`);

  it("passes on CI green with no verify line", () => {
    expect(verifiedOrGreen("", HEAD, PR, git, [], evidence(run()))).toEqual({ ok: true, via: "ci", runId: 9001 });
  });

  it("still passes on a stamped line, whatever CI says, an API error included", () => {
    expect(verifiedOrGreen(stamped, HEAD, PR, git, [".github/workflows/ci.yml"], { error: "503" })).toEqual({ ok: true, via: "stamp", commit: HEAD.slice(0, 9) });
  });

  it("needs the stamped line when the PR changes CI's own files", () => {
    const verdict = verifiedOrGreen("", HEAD, PR, git, [".github/workflows/ci.yml"], evidence(run()));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain(".github/workflows/ci.yml");
      expect(verdict.reason).toContain("pnpm verify passed on");
    }
  });

  it("refuses while CI runs, saying how many jobs are left", () => {
    const verdict = verifiedOrGreen("", HEAD, PR, git, [], evidence(run({ status: "queued", conclusion: null, jobs: [] })));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.running).toHaveLength(CI_JOBS.length);
      expect(verdict.reason).toContain(`CI still running on ${HEAD}: ${CI_JOBS.length} jobs left`);
    }
  });

  it("refuses on CI failed, naming both the missing line and the failed job", () => {
    const verdict = verifiedOrGreen("", HEAD, PR, git, [], evidence({ ...withJob("lint", { status: "completed", conclusion: "failure" }), conclusion: "failure" }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.running).toBeUndefined();
      expect(verdict.reason).toContain("lint (failure)");
      expect(verdict.reason).toContain("pnpm verify passed on");
    }
  });
});

describe("readCiEvidence", () => {
  it("turns any thrown error into evidence the verdict refuses", async () => {
    const read = await readCiEvidence(HEAD, {
      requiredChecks: async () => RULESET,
      ciRuns: async () => {
        throw new Error("GitHub GET actions/runs/1/jobs answered 500");
      },
    });
    expect(read).toEqual({ error: "GitHub GET actions/runs/1/jobs answered 500" });
  });
});

describe("ciOverHttp", () => {
  type Answer = { status: number; json?: unknown };
  const fetcher = (answers: Record<string, Answer>, asked: string[] = []) =>
    (async (url: string | URL | Request) => {
      const path = String(url).replace(`https://api.github.com/repos/${REPO}/`, "");
      asked.push(path);
      const answer = answers[path] ?? { status: 404 };
      return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status });
    }) as typeof fetch;

  it("reads the ruleset's required checks", async () => {
    const http = ciOverHttp(REPO, "t", fetcher({ "rules/branches/main": { status: 200, json: [{ type: "pull_request" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "lint" }, { context: "unit" }] } }] } }));
    expect(await http.requiredChecks()).toEqual(["lint", "unit"]);
  });

  it("reads the head's pull_request runs of ci.yml with each run's latest jobs", async () => {
    const asked: string[] = [];
    const http = ciOverHttp(
      REPO,
      "t",
      fetcher(
        {
          [`actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request&per_page=100`]: {
            status: 200,
            json: { workflow_runs: [{ id: 5, head_sha: HEAD, event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", repository: { full_name: REPO }, head_repository: { full_name: REPO }, pull_requests: [{ number: PR, head: { sha: HEAD }, base: { ref: "main" } }] }] },
          },
          "actions/runs/5/jobs?filter=latest&per_page=100": { status: 200, json: { total_count: 1, jobs: [{ name: "lint", status: "completed", conclusion: "success" }] } },
        },
        asked,
      ),
    );
    expect(await http.ciRuns(HEAD)).toEqual([{ id: 5, headSha: HEAD, event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", repo: REPO, headRepo: REPO, pulls: [{ number: PR, baseRef: "main" }], jobs: [{ name: "lint", status: "completed", conclusion: "success" }] }]);
  });

  it("fails rather than guess: an error answer, or more jobs than one page holds", async () => {
    await expect(ciOverHttp(REPO, "t", fetcher({})).requiredChecks()).rejects.toThrow(/404/);
    const http = ciOverHttp(
      REPO,
      "t",
      fetcher({
        [`actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request&per_page=100`]: { status: 200, json: { workflow_runs: [{ id: 5, head_sha: HEAD, event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", repository: { full_name: REPO }, head_repository: null }] } },
        "actions/runs/5/jobs?filter=latest&per_page=100": { status: 200, json: { total_count: 101, jobs: [] } },
      }),
    );
    await expect(http.ciRuns(HEAD)).rejects.toThrow(/101/);
  });
});
