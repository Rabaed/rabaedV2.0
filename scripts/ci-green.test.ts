import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CI_OWN_FILES,
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

  it("leaves app code, tests and other workflows alone", () => {
    for (const path of ["apps/api/src/app.ts", "scripts/queue-pr.ts", "apps/api/test/links.test.ts", ".github/workflows/deploy-uat.yml", "docs/visibility.md", "my-vitest.config.ts.md"]) expect(isCiOwnFile(path), path).toBe(false);
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

  it("counts a new package.json, one it cannot parse, and one it could read on neither side", () => {
    expect(ciOwnChanges(["packages/new/package.json"], versions(undefined, { scripts: { postinstall: "node x.js" } }))).toEqual(["packages/new/package.json"]);
    expect(ciOwnChanges(["package.json"], () => ({ before: "{", after: "{}" }))).toEqual(["package.json"]);
    expect(ciOwnChanges(["package.json"], () => ({ before: undefined, after: undefined }))).toEqual(["package.json"]);
  });
});

describe("CI_OWN_FILES", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const scriptsIn = (text: string) => [...text.matchAll(/(?:^|[\s/"'])(scripts\/[\w.-]+\.ts)/g)].map(([, path = ""]) => path);

  it("names every script and local action main's ci.yml runs", () => {
    const actions = [...ci.matchAll(/uses: (\.\/[^\s]+)/g)].map(([, path = ""]) => `${path.slice(2)}/action.yml`);
    for (const path of [...scriptsIn(ci), ...actions]) expect(isCiOwnFile(path), path).toBe(true);
    expect(scriptsIn(ci).length).toBeGreaterThan(3);
  });

  it("names every global setup the vitest configs load", () => {
    const setups = [...readFileSync("vitest.config.ts", "utf8").matchAll(/globalSetup: \[([^\]]*)\]/g)].flatMap(([, list = ""]) => [...list.matchAll(/"([^"]+)"/g)].map(([, path = ""]) => path));
    expect(setups.length).toBeGreaterThan(0);
    for (const path of setups) expect(isCiOwnFile(path), path).toBe(true);
  });

  it("names every scripts/ file the listed scripts import, all the way down", () => {
    const listed = CI_OWN_FILES.filter((entry) => /^scripts\/[\w.-]+\.ts$/.test(entry));
    const seen = new Set<string>();
    const walk = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const text = readFileSync(path, "utf8");
      for (const [, local = ""] of text.matchAll(/from "\.\/([\w.-]+\.ts)"/g)) walk(`scripts/${local}`);
    };
    for (const path of listed) walk(path);
    for (const path of seen) expect(isCiOwnFile(path), `${path} (imported by a listed script)`).toBe(true);
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
