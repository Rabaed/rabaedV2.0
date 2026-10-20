import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles, prePush, type PrePushSeam } from "./pre-push.ts";

// What git writes to a pre-push hook's stdin: one line per ref pushed.
const zero = "0000000000000000000000000000000000000000";
const branchPush = `refs/heads/RP-989-pre-push-hook ${"a".repeat(40)} refs/heads/RP-989-pre-push-hook ${"b".repeat(40)}\n`;

/** A seam whose checks exit with the given codes, and that records which ran. */
function seam(codes: { lint?: number; typecheck?: number } = {}, files: string[] | undefined = ["apps/api/src/a.ts"]) {
  const ran: string[] = [];
  const fake: PrePushSeam = {
    changedFiles: () => files,
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
