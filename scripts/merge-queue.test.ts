import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The merge queue on main (RP-394). Each queue entry is tested on a
// gh-readonly-queue/main/... branch by a merge_group event. Two guards keep
// the queue from committing screenshots: the stories job never uploads new
// baselines on a queue run, and update-screenshots.yml never pushes to a queue
// branch. These tests fail if either guard is removed.
//
// One CI run per push to a PR branch (RP-395): a workflow on both push and
// pull_request runs push only on main, so a PR branch gets its pull_request run
// alone. New story baselines therefore come from that run, and only for a PR
// from a branch of this repository: find-new keeps a fork's run off the commit job.

interface Step {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string[];
  steps: Step[];
}
interface Workflow {
  on: Record<string, { branches?: string[] } | null>;
  concurrency: { group: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, Job>;
}
const repo = join(dirname(import.meta.filename), "..");
const workflow = (name: string) => parse(readFileSync(join(repo, ".github", "workflows", name), "utf8")) as Workflow;
const job = (wf: Workflow, id: string): Job => {
  const found = wf.jobs[id];
  if (!found) throw new Error(`no job ${id}`);
  return found;
};
const step = (job: Job, name: string): Step => {
  const found = job.steps.find((s) => s.name === name);
  if (!found) throw new Error(`no step named "${name}"`);
  return found;
};
const notMergeGroup = /github\.event_name\s*!=\s*'merge_group'/;
const notQueueBranch = /!\s*startsWith\([^)]*,\s*'gh-readonly-queue\/'\)/;
const sameRepoRun = /github\.event\.workflow_run\.head_repository\.full_name\s*==\s*github\.repository/;
const sameRepoPullRequest = /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/;

describe.each(["ci.yml", "secret-scan.yml"])("%s in the merge queue", (name) => {
  it("runs on merge_group, so the queue gets its required checks", () => {
    expect(workflow(name).on).toHaveProperty("merge_group");
  });
});

describe("a workflow that runs on both push and pull_request", () => {
  const both = readdirSync(join(repo, ".github", "workflows"))
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => {
      const { on } = workflow(file);
      return typeof on === "object" && "push" in on && "pull_request" in on;
    });

  it("includes CI and the secret scan", () => {
    expect(both).toEqual(expect.arrayContaining(["ci.yml", "secret-scan.yml"]));
  });

  it.each(both)("%s runs on push only for main: a PR branch gets one run per push, its pull_request run", (file) => {
    // main keeps its push run. A push run on a
    // queue branch would also share ci.yml's concurrency group and cancel the queue's run.
    expect(workflow(file).on.push).toEqual({ branches: ["main"] });
  });
});

describe("ci.yml", () => {
  const ci = workflow("ci.yml");

  it("gives each queue entry its own concurrency group", () => {
    expect(ci.concurrency.group).toContain("${{ github.ref }}");
  });

  it.each(["migrations-immutable", "migration-drift"])("runs %s in the queue too, against the queue's base (RP-398)", (id) => {
    // Skipped, a required check counts as passing: two PRs whose migrations
    // clash would then merge together.
    expect(job(ci, id).if).toBe("github.event_name == 'pull_request' || github.event_name == 'merge_group'");
    // The step that checks must itself run on a queue run, with the queue's base.
    const checks = job(ci, id).steps.filter((s) => s.run?.startsWith("node scripts/check-migration"));
    const inQueue = checks.filter((s) => s.if === undefined || /github\.event_name\s*==\s*'merge_group'/.test(s.if));
    expect(inQueue).toHaveLength(1);
    expect(JSON.stringify(inQueue[0]?.env)).toContain("github.event.merge_group.base_sha");
  });

  it("checks migration drift in the queue from the PR's head, not the queue's merge commit", () => {
    const inQueue = job(ci, "migration-drift").steps.find((s) => s.if === "github.event_name == 'merge_group'");
    expect(inQueue?.run).toContain("--merge-group");
  });

  it("never collects or uploads the baselines of new stories on a queue run", () => {
    for (const name of ["Collect the baselines of new stories", "Upload the baselines of new stories"]) {
      expect(step(job(ci, "stories"), name).if, name).toMatch(notMergeGroup);
    }
  });

  it("uploads the baselines of new stories only from a pull_request run of a branch in this repository", () => {
    const upload = step(job(ci, "stories"), "Collect the baselines of new stories").env?.UPLOAD ?? "";
    expect(upload).toMatch(/github\.event_name\s*==\s*'pull_request'/);
    expect(upload).toMatch(sameRepoPullRequest);
  });
});

describe("update-screenshots.yml", () => {
  const wf = workflow("update-screenshots.yml");

  it("takes new baselines only from a CI run started by a pull request, never a queue run", () => {
    expect(job(wf, "find-new").if).toMatch(/github\.event\.workflow_run\.event\s*==\s*'pull_request'/);
    expect(job(wf, "find-new").if).toMatch(notQueueBranch);
  });

  it("never reaches the commit job from a fork's CI run", () => {
    // A fork's pull_request run has the fork as its head repository.
    expect(job(wf, "find-new").if).toMatch(sameRepoRun);
    expect(job(wf, "commit").needs).toEqual(expect.arrayContaining(["render", "find-new"]));
    expect(job(wf, "render").if).toMatch(sameRepoPullRequest);
  });

  it("never commits to a queue branch", () => {
    expect(job(wf, "commit").if).toMatch(notQueueBranch);
    expect(step(job(wf, "commit"), "Commit changed baselines").run).toMatch(/gh-readonly-queue\/\*\)/);
  });

  // RP-1199: one run per PR, and a run that is mid-push is never cancelled.
  describe("concurrency", () => {
    // Each check returns what is wrong. A test runs it on the real text (nothing wrong)
    // and on a copy with one mutation (something wrong), so the check is known to bite.
    // There is no evaluator for the expression: these read its text.
    const squash = (text: string) => text.replace(/\s+/g, " ").trim();
    const mutate = (text: string, from: string, to: string) => {
      if (!text.includes(from)) throw new Error(`the mutation target is not in the text: ${from}`);
      return text.replace(from, to);
    };
    const group = squash(wf.concurrency.group);
    const findNewIf = job(wf, "find-new").if;

    // A render starts from a PR only on the label. A leftover ui-changed job (it picked a
    // PR's pushes by their files) would mean a push path is back.
    const triggerProblems = (on: Record<string, unknown>, jobIds: string[]) => {
      const problems: string[] = [];
      if ("push" in on) problems.push("a push trigger");
      if (JSON.stringify(on.pull_request) !== JSON.stringify({ types: ["labeled"] })) problems.push("pull_request is not [labeled] only");
      if (jobIds.includes("ui-changed")) problems.push("a ui-changed job");
      return problems;
    };

    // The skip clause is `workflow_run && !(` find-new's other conditions, in order `)`, so a
    // run find-new would skip gets a group of its own. A deleted find-new `if` is a problem.
    const skipProblems = (text: string, ifText: string | undefined) => {
      if (!ifText) return ["find-new has no if to mirror"];
      const [event, ...rest] = squash(ifText).split(" && ");
      const problems: string[] = [];
      if (event !== "github.event_name == 'workflow_run'") problems.push("find-new does not start with the workflow_run event check");
      if (!text.includes(`${event} && !( ${rest.join(" && ")})`)) problems.push("the skip clause is not the event check and the negation of find-new's conditions");
      if (!text.includes("format('skipped-{0}', github.run_id)")) problems.push("no skipped- group");
      if (!text.includes("github.event.label.name != 'update-screenshots'")) problems.push("no skip for other labels");
      return problems;
    };

    // The order of the fallbacks matters: the PR number first, then the branch.
    const keyProblems = (text: string) =>
      [
        "github.event.pull_request.number || github.head_ref || github.ref_name",
        "format('new-{0}', github.event.workflow_run.pull_requests[0].number || github.event.workflow_run.head_branch)",
      ].filter((key) => !text.includes(key));

    it("never cancels a run in progress", () => {
      expect(wf.concurrency["cancel-in-progress"]).toBe(false);
    });

    it("starts a render from a PR only on the label, never on a push", () => {
      expect(triggerProblems(wf.on, Object.keys(wf.jobs))).toEqual([]);
      expect(wf.on.push).toBeUndefined();
    });

    it("catches a push trigger, more pull_request types and a ui-changed job", () => {
      expect(triggerProblems({ ...wf.on, push: { branches: ["main"] } }, [])).toContain("a push trigger");
      expect(triggerProblems({ ...wf.on, push: null }, [])).toContain("a push trigger");
      expect(triggerProblems({ pull_request: { types: ["labeled", "synchronize"] } }, [])).toContain("pull_request is not [labeled] only");
      expect(triggerProblems(wf.on, ["ui-changed", "render"])).toContain("a ui-changed job");
    });

    it("gives a run that find-new would skip a group of its own, so it cannot replace a waiting run", () => {
      expect(skipProblems(group, findNewIf)).toEqual([]);
    });

    it("catches a skip clause that no longer mirrors find-new", () => {
      expect(skipProblems(group, undefined)).toEqual(["find-new has no if to mirror"]);
      expect(skipProblems(mutate(group, "&& !( ", "&& ( "), findNewIf)).toHaveLength(1);
      expect(skipProblems(mutate(group, "(github.event_name == 'workflow_run' && !(", "(!("), findNewIf)).toHaveLength(1);
      expect(skipProblems(mutate(group, " && github.event.workflow_run.event == 'pull_request'", ""), findNewIf)).toHaveLength(1);
      expect(skipProblems(mutate(group, "format('skipped-{0}', github.run_id)", "format('{0}', github.run_id)"), findNewIf)).toHaveLength(1);
      expect(skipProblems(mutate(group, "github.event.label.name != 'update-screenshots'", "true"), findNewIf)).toHaveLength(1);
    });

    it("keeps the new-baselines run out of the label's group, so it can never replace a waiting label run", () => {
      expect(group).toMatch(/github\.event_name == 'workflow_run' && format\('new-\{0\}', /);
    });

    it("keys the label and the new-baselines run by the PR number, else the branch, in that order", () => {
      expect(keyProblems(group)).toEqual([]);
    });

    it("catches a reordered or dropped fallback", () => {
      const label = "github.event.pull_request.number || github.head_ref || github.ref_name";
      expect(keyProblems(mutate(group, label, "github.head_ref || github.event.pull_request.number || github.ref_name"))).toEqual([label]);
      expect(keyProblems(mutate(group, label, "github.event.pull_request.number || github.ref_name"))).toEqual([label]);
      expect(keyProblems(mutate(group, "pull_requests[0].number || github.event.workflow_run.head_branch", "pull_requests[0].number"))).toHaveLength(1);
      expect(keyProblems(mutate(group, "pull_requests[0].number || github.event.workflow_run.head_branch", "head_branch || github.event.workflow_run.pull_requests[0].number"))).toHaveLength(1);
    });
  });
});
