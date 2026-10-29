import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { auditNeeded, decideAudit } from "./dependency-audit-needed.ts";

// RP-1032: the package audit is a required check, so its job runs on every pull request and
// merge-group entry, and audits only a change that can move what it audits.

describe("auditNeeded", () => {
  it("audits a change to the lockfile, any package.json, pnpm's workspace settings or .npmrc", () => {
    expect(auditNeeded(["pnpm-lock.yaml"])).toBe(true);
    expect(auditNeeded(["package.json"])).toBe(true);
    expect(auditNeeded(["apps/web/package.json"])).toBe(true);
    expect(auditNeeded(["pnpm-workspace.yaml"])).toBe(true);
    expect(auditNeeded([".npmrc"])).toBe(true);
  });

  it("audits a change to the allow-list, the audit's scripts, the code its decision runs on, or its workflow", () => {
    expect(auditNeeded([".audit-allowlist.json"])).toBe(true);
    expect(auditNeeded(["scripts/dependency-audit.ts"])).toBe(true);
    expect(auditNeeded(["scripts/dependency-audit-needed.ts"])).toBe(true);
    expect(auditNeeded(["scripts/docs-only.ts"])).toBe(true);
    expect(auditNeeded([".github/workflows/dependency-audit.yml"])).toBe(true);
  });

  it("audits a workspace package removed or renamed: its old package.json is in the list alone", () => {
    expect(auditNeeded(["packages/old-name/package.json"])).toBe(true);
  });

  it("skips a change that touches none of them, even names next to them", () => {
    expect(auditNeeded(["apps/web/src/app/page.tsx", "docs/visibility.md"])).toBe(false);
    expect(auditNeeded(["apps/web/package.json.bak", "scripts/dependency-audit.test.ts", "apps/web/.npmrc.example"])).toBe(false);
  });

  it("skips an empty change", () => {
    expect(auditNeeded([])).toBe(false);
  });
});

describe("decideAudit", () => {
  const listing = (files: string[]) => {
    const asked: string[] = [];
    return { asked, changedSince: (base: string) => (asked.push(base), files) };
  };

  it("decides from the files changed since the base commit", () => {
    const git = listing(["README.md"]);
    expect(decideAudit("base1", git.changedSince)).toEqual({ needed: false, base: "base1", files: 1 });
    expect(git.asked).toEqual(["base1"]);
  });

  it("audits a docs PR queued behind a lockfile PR: the merge group's diff from main holds both", () => {
    const git = listing(["docs/a.md", "pnpm-lock.yaml"]);
    expect(decideAudit("refs/heads/main", git.changedSince)).toEqual({ needed: true, base: "refs/heads/main", files: 2 });
  });

  it.each([undefined, ""])("always audits without a base (the nightly run, a run by hand): %j", (base) => {
    const git = listing(["README.md"]);
    expect(decideAudit(base, git.changedSince)).toEqual({ needed: true });
    expect(git.asked).toEqual([]);
  });
});

// The wiring in dependency-audit.yml. A step skipped by its own `if:` leaves the job's check green; a
// workflow skipped by `paths` reports nothing and a required check never passes (RP-984).
interface Step {
  id?: string;
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}
const workflow = parse(readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "dependency-audit.yml"), "utf8")) as {
  on: Record<string, Record<string, unknown> | null>;
  jobs: Record<string, { name?: string; steps: Step[] }>;
};
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const decide = steps.find((step) => step.run === "node scripts/dependency-audit-needed.ts");
const audit = steps.find((step) => /^pnpm audit .*--json/.test(step.run ?? ""));
const gate = "steps.needed.outputs.needed == 'true'";

// The workflow runs this script, so it changes in its own PR after this one (rule 3); until then these wait for it.
describe.skipIf(decide === undefined)("dependency-audit.yml runs on every change and audits the ones that need it", () => {
  it("filters no event by path, and runs in the merge queue", () => {
    for (const trigger of Object.values(workflow.on)) {
      expect(Object.keys(trigger ?? {})).not.toContain("paths");
      expect(Object.keys(trigger ?? {})).not.toContain("paths-ignore");
    }
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(["pull_request", "merge_group", "schedule"]));
  });

  it("decides against main's tip in merge_group, never the group's base_sha, and the PR's base otherwise", () => {
    expect(decide?.id).toBe("needed");
    expect(decide?.env?.BASE).toBe("${{ github.event.merge_group.base_ref || github.event.pull_request.base.sha }}");
  });

  it("audits and reports only when the decision says so", () => {
    const report = steps.find((step) => step.run === "node scripts/dependency-audit.ts audit.json --level high");
    expect(audit?.if).toBe(gate);
    expect(report?.if).toBe(gate);
  });
});

// RP-1070: the dev dependencies are audited too (why: scripts/dependency-audit.ts's header). The workflow drops
// `--prod` and renames the step in its own PR after this one (rule 3). Until then this waits for it, skipping only
// while both are as before, so a workflow that changes one without the other fails here.
const beforeRp1070 = audit?.name === "pnpm audit --prod" && audit.run?.includes("--prod") === true;
describe.skipIf(beforeRp1070)("dependency-audit.yml audits the dev dependencies too", () => {
  it("runs pnpm audit without --prod, every severity into the JSON the report reads", () => {
    expect(audit?.name).toBe("pnpm audit");
    expect(audit?.run).toBe("pnpm audit --json > audit.json || true");
  });
});
