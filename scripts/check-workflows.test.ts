import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintRepository, lintWorkflow } from "./check-workflows.ts";

const SHA = "ea17c68df8912ef543352723c149a84f56e3d413";
const messages = (source: string) => lintWorkflow("w.yml", source).map((f) => `${f.where}: ${f.message}`);

const safe = (extra = "") => `
on: push
permissions: { contents: read }
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
${extra}`;

describe("lintWorkflow", () => {
  it("passes a hardened workflow", () => {
    expect(messages(safe(`      - uses: pnpm/action-setup@${SHA} # v6.1.0`))).toEqual([]);
  });

  describe("persist-credentials", () => {
    it("flags a checkout that leaves credentials persisted", () => {
      const found = messages("on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n");
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("persist-credentials");
    });

    it("flags persist-credentials: true", () => {
      expect(messages("on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: true\n")).toHaveLength(1);
    });

    it("accepts a comment above the step that gives the reason", () => {
      const source = "on: push\njobs:\n  a:\n    steps:\n      - run: echo\n      # Credentials stay: the push below needs them.\n      - uses: actions/checkout@v7\n";
      expect(messages(source)).toEqual([]);
    });

    it("does not take another step's comment as the reason", () => {
      const source = "on: push\njobs:\n  a:\n    steps:\n      # Credentials are fine here.\n      - run: echo\n      - uses: actions/checkout@v7\n";
      expect(messages(source)).toHaveLength(1);
    });
  });

  it("flags pull_request_target in any form", () => {
    for (const on of ["pull_request_target", "[push, pull_request_target]", "\n  pull_request_target:\n    types: [labeled]"]) {
      expect(messages(`on: ${on}\njobs: {}\n`).join()).toContain("pull_request_target");
    }
  });

  describe("write tokens and fork code", () => {
    const run = (jobs: string, on = "workflow_run: { workflows: [CI] }") => messages(`on:\n  ${on}\npermissions: {}\njobs:\n${jobs}`);
    const checkout = "      - uses: actions/checkout@v7\n        with: { persist-credentials: false }\n";

    it("flags a write job that checks out code with no same-repository guard", () => {
      const found = run(`  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("job a");
    });

    it("accepts the guard on the job, or on a job it needs", () => {
      const guard = "github.event.workflow_run.head_repository.full_name == github.repository";
      expect(run(`  a:\n    if: ${guard}\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
      expect(run(`  f:\n    if: ${guard}\n  a:\n    needs: [f]\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
    });

    it("accepts the pull_request form of the guard", () => {
      const job = `  a:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    permissions: { id-token: write }\n    steps:\n${checkout}`;
      expect(run(job, "pull_request:")).toEqual([]);
    });

    it("takes a guard on an unrelated job as no guard", () => {
      const guard = "github.event.workflow_run.head_repository.full_name == github.repository";
      expect(run(`  f:\n    if: ${guard}\n  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toHaveLength(1);
    });

    it("uses the workflow's permissions when the job sets none", () => {
      expect(messages(`on: workflow_run\npermissions: write-all\njobs:\n  a:\n    steps:\n${checkout}`)).toHaveLength(1);
    });

    it("ignores read-only jobs, jobs without a checkout, and workflows nothing external starts", () => {
      expect(run(`  a:\n    permissions: { contents: read }\n    steps:\n${checkout}`)).toEqual([]);
      expect(run("  a:\n    permissions: { pull-requests: write }\n    steps:\n      - run: gh pr edit\n")).toEqual([]);
      expect(messages(`on: [push, workflow_dispatch]\njobs:\n  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
    });
  });

  describe("pinning", () => {
    it("flags a third-party action on a tag or branch", () => {
      const found = messages(safe("      - uses: docker/setup-buildx-action@v4\n      - uses: some/thing@main\n"));
      expect(found).toHaveLength(2);
      expect(found[0]).toContain("docker/setup-buildx-action@v4");
    });

    it("accepts actions/ and github/ on tags, local actions, and a SHA", () => {
      expect(messages(safe("      - uses: actions/setup-node@v7\n      - uses: github/codeql-action/init@v3\n      - uses: ./.github/actions/test-timing\n"))).toEqual([]);
    });

    it("flags a short SHA", () => {
      expect(messages(safe("      - uses: pnpm/action-setup@ea17c68\n"))).toHaveLength(1);
    });

    it("flags a Docker image without a digest", () => {
      expect(messages(safe("      - uses: docker://alpine:3.20\n"))).toHaveLength(1);
      expect(messages(safe(`      - uses: docker://alpine@sha256:${"a".repeat(64)}\n`))).toEqual([]);
    });

    it("checks the steps of a composite action", () => {
      const source = "name: x\nruns:\n  using: composite\n  steps:\n    - uses: some/thing@v1\n";
      expect(messages(source)).toHaveLength(1);
    });
  });

  describe("script injection", () => {
    it("flags untrusted text written into a run script", () => {
      expect(messages(safe("      - run: echo ${{ github.head_ref }}\n"))).toHaveLength(1);
      expect(messages(safe("      - run: echo '${{ github.event.workflow_run.head_branch }}'\n"))).toHaveLength(1);
    });

    it("accepts it passed through env", () => {
      expect(messages(safe('      - run: echo "$BRANCH"\n        env: { BRANCH: "${{ github.head_ref }}" }\n'))).toEqual([]);
    });
  });

  it("reports invalid YAML", () => {
    expect(messages("on: [unclosed\n").join()).toContain("not valid YAML");
  });
});

describe("the repository's own workflows", () => {
  it("follow the hardening rules", () => {
    const root = join(dirname(import.meta.filename), "..");
    expect(lintRepository(root)).toEqual([]);
  });
});
