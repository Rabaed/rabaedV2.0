import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { decideDocsOnly, docsOnly } from "./docs-only.ts";

describe("docsOnly", () => {
  it("counts a .md file outside docs/ as a doc", () => {
    expect(docsOnly(["planning/parallel-sessions.md"])).toBe(true);
  });

  it("counts a file under docs/ as a doc, whatever its type", () => {
    expect(docsOnly(["docs/adr/diagram.png", "docs/agents/ci-logs.md"])).toBe(true);
  });

  it("is not docs-only when one file of the change is code", () => {
    expect(docsOnly(["docs/workflow-engine.md", "GLOSSARY.md", "scripts/verify.ts"])).toBe(false);
  });

  it("is not docs-only for an empty change, so CI runs everything", () => {
    expect(docsOnly([])).toBe(false);
  });
});

describe("decideDocsOnly", () => {
  const listing = (files: string[]) => {
    const asked: string[] = [];
    return { asked, changedSince: (base: string) => (asked.push(base), files) };
  };

  it("decides from the files changed since the base commit", () => {
    const git = listing(["planning/parallel-sessions.md"]);
    expect(decideDocsOnly("base1", git.changedSince)).toEqual({ docsOnly: true, base: "base1", files: 1 });
    expect(git.asked).toEqual(["base1"]);
  });

  it("is not docs-only when the code PR ahead of a docs PR in the merge group is in the diff from main", () => {
    const git = listing(["docs/a.md", "apps/api/src/a.ts"]);
    expect(decideDocsOnly("refs/heads/main", git.changedSince)).toMatchObject({ docsOnly: false, base: "refs/heads/main" });
  });

  it.each([undefined, ""])("never skips without a base (push, workflow_dispatch: main's push run feeds the deploy): %j", (base) => {
    const git = listing(["docs/a.md"]);
    expect(decideDocsOnly(base, git.changedSince)).toEqual({ docsOnly: false });
    expect(git.asked).toEqual([]);
  });
});

// The gate in ci.yml. A job skipped by its own `if:` reports success to the main ruleset; a
// workflow skipped by `paths`/`paths-ignore` reports nothing and the required check never passes.
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps: { run?: string; uses?: string; env?: Record<string, string> }[];
}
const ci = parse(readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "ci.yml"), "utf8")) as {
  on: Record<string, Record<string, unknown> | null>;
  jobs: Record<string, Job>;
};
const needs = (job: Job) => (job.needs === undefined ? [] : [job.needs].flat());
const heavy = ["typecheck", "unit", "web-build", "web-image", "stories", "seam1", "seam1-result", "seam2", "mail", "infra"];
/** The jobs that run on a docs-only change: the decision, the docs checks, lint and the checks that read only the repository. */
const light = ["changes", "docs", "lint", "workflows-hardened", "migrations-immutable", "migration-drift"];
const gate = "${{ !cancelled() && needs.changes.outputs.docs_only != 'true' }}";

describe("ci.yml's docs-only gate", () => {
  it("filters no event by path", () => {
    for (const trigger of Object.values(ci.on)) {
      expect(Object.keys(trigger ?? {})).not.toEqual(expect.arrayContaining(["paths"]));
      expect(Object.keys(trigger ?? {})).not.toEqual(expect.arrayContaining(["paths-ignore"]));
    }
  });

  it("decides with scripts/docs-only.ts against main's tip in merge_group, never the group's base_sha, and the PR's base otherwise", () => {
    const changes = ci.jobs.changes;
    expect(changes?.outputs?.docs_only).toBe("${{ steps.decide.outputs.docs_only }}");
    const decide = changes?.steps.find((s) => s.run === "node scripts/docs-only.ts");
    // base_sha is main plus the entries ahead: against it, a docs PR behind a code PR would skip.
    expect(decide?.env?.BASE).toBe("${{ github.event.merge_group.base_ref || github.event.pull_request.base.sha }}");
  });

  it.each(heavy)("runs %s unless the change is docs-only, and also when the decision itself failed", (id) => {
    const job = ci.jobs[id];
    expect(job, id).toBeDefined();
    expect(needs(job as Job)).toContain("changes");
    expect(job?.if).toBe(gate);
  });

  it("gates every job but the light ones: a new job skips on docs-only unless it joins the light list on purpose", () => {
    const ungated = Object.entries(ci.jobs).filter(([, job]) => job.if !== gate).map(([id]) => id);
    expect(ungated.sort()).toEqual([...light].sort());
  });

  it.each(light.filter((id) => id !== "docs"))("still runs %s on a docs-only change", (id) => {
    expect(ci.jobs[id]?.if ?? "", id).not.toContain("docs_only");
    expect(needs(ci.jobs[id] as Job), id).not.toContain("changes");
  });

  it("runs every scripts/ unit test on a docs-only change: they hold each test that reads the docs, which the skipped unit job would have run", () => {
    const docs = ci.jobs.docs;
    expect(docs?.if).toBe("${{ needs.changes.outputs.docs_only == 'true' }}");
    expect(docs?.steps.map((s) => s.run)).toContain("pnpm exec vitest run --project unit scripts/");
  });
});
