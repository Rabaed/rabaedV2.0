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
  concurrency: { group: string };
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
    // main keeps its push run, which deploy-dev.yml follows. A push run on a
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
    const condition = job(ci, id).if ?? "";
    expect(condition).toMatch(/github\.event_name\s*==\s*'pull_request'/);
    expect(condition).toMatch(/github\.event_name\s*==\s*'merge_group'/);
    expect(JSON.stringify(job(ci, id).steps)).toContain("github.event.merge_group.base_sha");
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
});
