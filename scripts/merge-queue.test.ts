import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The merge queue on main (RP-394). Each queue entry is tested on a
// gh-readonly-queue/main/... branch by a merge_group event. Two guards keep
// the queue from committing screenshots: the stories job never uploads new
// baselines on a queue run, and update-screenshots.yml never pushes to a queue
// branch. These tests fail if either guard is removed.

interface Step {
  name?: string;
  if?: string;
  run?: string;
}
interface Job {
  if?: string;
  steps: Step[];
}
interface Workflow {
  on: Record<string, { "branches-ignore"?: string[] } | null>;
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

describe.each(["ci.yml", "secret-scan.yml"])("%s in the merge queue", (name) => {
  const { on } = workflow(name);

  it("runs on merge_group, so the queue gets its required checks", () => {
    expect(on).toHaveProperty("merge_group");
  });

  it("does not also run on the push to the queue branch", () => {
    // A push run on the same ref would share ci.yml's concurrency group and
    // cancel the queue's run.
    expect(on.push?.["branches-ignore"]).toContain("gh-readonly-queue/**");
  });
});

describe("ci.yml", () => {
  const ci = workflow("ci.yml");

  it("gives each queue entry its own concurrency group", () => {
    expect(ci.concurrency.group).toContain("github.ref");
  });

  it("never collects or uploads the baselines of new stories on a queue run", () => {
    for (const name of ["Collect the baselines of new stories", "Upload the baselines of new stories"]) {
      expect(step(job(ci, "stories"), name).if, name).toMatch(notMergeGroup);
    }
  });
});

describe("update-screenshots.yml", () => {
  const wf = workflow("update-screenshots.yml");

  it("takes new baselines only from a CI run started by a push, never a queue run", () => {
    expect(job(wf, "find-new").if).toMatch(/github\.event\.workflow_run\.event\s*==\s*'push'/);
    expect(job(wf, "find-new").if).toMatch(notQueueBranch);
  });

  it("never commits to a queue branch", () => {
    expect(job(wf, "commit").if).toMatch(notQueueBranch);
    expect(step(job(wf, "commit"), "Commit changed baselines").run).toMatch(/gh-readonly-queue\/\*\)/);
  });
});
