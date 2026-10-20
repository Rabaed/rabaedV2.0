import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedSince, decideDocsOnly } from "./docs-only.ts";

// A throwaway origin and a one-commit-deep checkout of it, as CI's checkout leaves one. In the
// checkout, a code commit and then a docs commit stand for a merge group: a code PR, then a
// docs-only PR queued behind it.
let root: string;
let checkout: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" }).trim();

function commit(files: Record<string, string>, message = "change") {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true });
    writeFileSync(join(checkout, path), content);
  }
  git(checkout, "add", "-A");
  git(checkout, "commit", "-q", "-m", message);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-docs-only-"));
  const origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "a.ts"), "export {};\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "start");
  git(root, "clone", "-q", "--depth=1", pathToFileURL(origin).href, "checkout");
  checkout = join(root, "checkout");
}, 30_000);

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("changedSince, from a shallow checkout", () => {
  it("lists a code PR ahead of a docs PR in the group, so the entry is not docs-only", () => {
    commit({ "apps/api/src/b.ts": "export {};\n" }, "code PR");
    commit({ "planning/parallel-sessions.md": "# Notes\n" }, "docs PR");
    expect(changedSince(checkout, "refs/heads/main").sort()).toEqual(["apps/api/src/b.ts", "planning/parallel-sessions.md"]);
    expect(decideDocsOnly("refs/heads/main", (base) => changedSince(checkout, base)).docsOnly).toBe(false);
  });

  it("is docs-only when every commit since main changes docs", () => {
    commit({ "planning/parallel-sessions.md": "# Notes\n", "docs/adr/0099-x.md": "# ADR\n" });
    expect(decideDocsOnly("refs/heads/main", (base) => changedSince(checkout, base)).docsOnly).toBe(true);
  });

  it("lists a renamed file's old path too: code renamed to .md is a code change", () => {
    git(checkout, "mv", "a.ts", "a.md");
    git(checkout, "commit", "-q", "-m", "rename");
    expect(changedSince(checkout, "refs/heads/main").sort()).toEqual(["a.md", "a.ts"]);
  });
}, 30_000);
