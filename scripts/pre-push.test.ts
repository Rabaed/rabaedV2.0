import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkClaims } from "./check-claims.ts";
import type { MergeState } from "./merge-in-progress.ts";
import { changedFiles, prePush, type PrePushSeam } from "./pre-push.ts";

// What git writes to a pre-push hook's stdin: one line per ref pushed.
const zero = "0000000000000000000000000000000000000000";
const branchPush = `refs/heads/RP-989-pre-push-hook ${"a".repeat(40)} refs/heads/RP-989-pre-push-hook ${"b".repeat(40)}\n`;

/** A seam whose checks exit with the given codes, and that records which ran. */
function seam(
  codes: { lint?: number; typecheck?: number } = {},
  files: string[] | undefined = ["apps/api/src/a.ts"],
  tree = { head: "a".repeat(40), dirty: false },
  mix?: string[],
  claims: { ok: boolean; message: string } = { ok: true, message: "" },
  merge: MergeState = { inProgress: false },
) {
  const ran: string[] = [];
  const fake: PrePushSeam = {
    changedFiles: () => files,
    branchMix: () => mix,
    claims: async () => claims,
    mergeState: () => merge,
    workingTree: () => tree,
    run: async (script) => {
      ran.push(script);
      const status = codes[script] ?? 0;
      return { status, output: `${script} said ${status === 0 ? "fine" : "error TS2304"}` };
    },
  };
  return { fake, ran };
}

describe("prePush", () => {
  it("refuses a push whose lint fails, judged by exit code, and shows lint's output", async () => {
    const { fake } = seam({ lint: 1 });
    const result = await prePush(branchPush, fake);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("lint said error TS2304");
  });

  it("refuses a push whose typecheck fails, even with lint passing", async () => {
    const { fake, ran } = seam({ typecheck: 2 });
    const result = await prePush(branchPush, fake);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("pnpm typecheck failed (exit 2)");
    expect(result.message).not.toContain("pnpm lint failed");
    expect(ran.sort()).toEqual(["lint", "typecheck"]);
  });

  it("lets a push go when lint and typecheck both exit 0", async () => {
    const { fake, ran } = seam();
    expect((await prePush(branchPush, fake)).ok).toBe(true);
    expect(ran.sort()).toEqual(["lint", "typecheck"]);
  });

  it("says so when the checked tree is not the pushed commit: another branch pushed, or uncommitted changes", async () => {
    const clean = await prePush(branchPush, seam().fake);
    expect(clean.message).not.toContain("working tree");
    const other = await prePush(branchPush, seam({}, undefined, { head: "f".repeat(40), dirty: false }).fake);
    expect(other.message).toContain(`checked the working tree (HEAD ffffffff), not ${"a".repeat(8)} pushed to RP-989-pre-push-hook`);
    const dirty = await prePush(branchPush, seam({ lint: 1 }, undefined, { head: "a".repeat(40), dirty: true }).fake);
    expect(dirty.message).toContain("checked the working tree, which has uncommitted changes");
  });

  it("runs nothing for a branch deletion or a tag", async () => {
    const { fake, ran } = seam({ lint: 1 });
    const stdin = `(delete) ${zero} refs/heads/old ${"c".repeat(40)}\nrefs/tags/epic-start/x ${"d".repeat(40)} refs/tags/epic-start/x ${zero}\n`;
    expect((await prePush(stdin, fake)).ok).toBe(true);
    expect(ran).toEqual([]);
  });

  it("runs nothing for a push that changes only docs", async () => {
    const { fake, ran } = seam({ lint: 1 }, ["docs/visibility.md", "planning/notes.md", "docs/adr/0030.md"]);
    expect((await prePush(branchPush, fake)).ok).toBe(true);
    expect(ran).toEqual([]);
  });

  it("names a branch that mixes the lockfile with code, which pnpm queue will refuse, and still lets the push go (RP-993)", async () => {
    const mix = ["  shared: pnpm-lock.yaml", "  and 1 other file(s), e.g. apps/admin/src/a.ts", "For dependencies: put … in a dependencies-only PR first"];
    const passing = await prePush(branchPush, seam({}, undefined, undefined, mix).fake);
    expect(passing.ok).toBe(true);
    expect(passing.message).toContain("Warning: RP-989-pre-push-hook changes root shared file(s) together with other files, so `pnpm queue` will refuse it (rule 3):");
    expect(passing.message).toContain(mix.join("\n"));
    const docsOnly = await prePush(branchPush, seam({}, ["docs/a.md"], undefined, mix).fake);
    expect(docsOnly.message).toContain("  shared: pnpm-lock.yaml");
    expect((await prePush(branchPush, seam({ lint: 1 }, undefined, undefined, mix).fake)).message).toContain("  shared: pnpm-lock.yaml");
    expect((await prePush(branchPush, seam().fake)).message).not.toContain("shared:");
  });

  it("refuses a push whose branch changes a shared module with no open claim, docs-only too, before lint and typecheck (RP-1008)", async () => {
    const refused = { ok: false, message: "check:claims (rule 12): RP-989 has no open CLAIM on RP-603 for:\n  docs/agents/issue-tracker.md" };
    for (const files of [["apps/api/src/a.ts"], ["docs/agents/issue-tracker.md"]]) {
      const { fake, ran } = seam({}, files, undefined, undefined, refused);
      const result = await prePush(branchPush, fake);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("  docs/agents/issue-tracker.md");
      expect(result.message).toContain("Push refused (pre-push, RP-1008)");
      expect(ran).toEqual([]);
    }
  });

  it("passes on the claims check's warning when RP-603 can't be read, and shows it", async () => {
    const warned = { ok: true, message: "Warning: check:claims could not read RP-603 (fetch failed)" };
    const result = await prePush(branchPush, seam({}, undefined, undefined, undefined, warned).fake);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Warning: check:claims could not read RP-603 (fetch failed)");
  });

  it("shows rule 3's workflow warning on a push that changes a workflow beside a script, and still lets it go (RP-1199)", async () => {
    const files = [".github/workflows/ci.yml", "scripts/ci-helper.ts"];
    // The claims seam is the real check, with RP-603 unreadable as it is with no Jira credentials.
    const claims = await checkClaims({
      key: "RP-989",
      files,
      redefined: [],
      sharedList: readFileSync(join(import.meta.dirname, "..", "docs", "agents", "issue-tracker.md"), "utf8"),
      comments: async () => {
        throw new Error("no credentials");
      },
    });
    const { fake, ran } = seam({}, files, undefined, undefined, claims);
    const result = await prePush(branchPush, fake);
    expect(result.ok).toBe(true);
    expect(ran.sort()).toEqual(["lint", "typecheck"]);
    expect(result.message).toContain("Warning: check:claims (rule 3)");
    expect(result.message).toContain("  .github/workflows/ci.yml");
    expect(result.message).toContain("  scripts/ci-helper.ts");
  });

  it("refuses a branch push while a merge is in progress, naming the conflicted files, before anything else runs (RP-1101)", async () => {
    const merging: MergeState = { inProgress: true, conflicted: ["docs/visibility.md"] };
    for (const files of [["apps/api/src/a.ts"], ["docs/visibility.md"]]) {
      const { fake, ran } = seam({}, files, undefined, undefined, undefined, merging);
      const result = await prePush(branchPush, fake);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Push refused: a merge is in progress (MERGE_HEAD exists).");
      expect(result.message).toContain("  docs/visibility.md");
      expect(ran).toEqual([]);
    }
    // Deleting a branch or pushing a tag carries none of the half-merged tree.
    const stdin = `(delete) ${zero} refs/heads/old ${"c".repeat(40)}
`;
    expect((await prePush(stdin, seam({}, undefined, undefined, undefined, undefined, merging).fake)).ok).toBe(true);
  });

  it("runs the checks when the push changes a doc and code, or its files can't be told", async () => {
    for (const files of [["docs/visibility.md", "package.json"], undefined]) {
      const { fake, ran } = seam({}, files);
      await prePush(branchPush, fake);
      expect(ran.sort()).toEqual(["lint", "typecheck"]);
    }
  });
});

describe("changedFiles", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const commit = (path: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), `${path}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", path);
    return git("rev-parse", "HEAD");
  };
  const ref = (localSha: string, remoteSha = zero) => ({ localRef: "refs/heads/RP-1", localSha, remoteRef: "refs/heads/RP-1", remoteSha });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-pre-push-repo-"));
    git("init", "-q", "-b", "main");
    git("update-ref", "refs/remotes/origin/main", commit("README.md"));
    git("checkout", "-q", "-b", "RP-1");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("a new branch: every file it changed since it left origin/main", () => {
    commit("docs/a.md");
    expect(changedFiles(repo, ref(commit("apps/api/src/b.ts"))).sort()).toEqual(["apps/api/src/b.ts", "docs/a.md"]);
  });

  it("a branch the remote has: only what this push adds", () => {
    const pushed = commit("apps/api/src/b.ts");
    expect(changedFiles(repo, ref(commit("docs/a.md"), pushed))).toEqual(["docs/a.md"]);
  });

  it("a remote commit this clone doesn't have: falls back to origin/main", () => {
    expect(changedFiles(repo, ref(commit("docs/a.md"), "e".repeat(40)))).toEqual(["docs/a.md"]);
  });
});
