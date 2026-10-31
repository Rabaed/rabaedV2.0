import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorityFolderProblem, repoRootOf } from "./uat-authority-folder.ts";

// The UAT sealing authority's key is written only outside any git checkout (RP-1042): the repo is public.

const base = mkdtempSync(join(tmpdir(), "rabaed-uat-authority-"));
const repo = join(base, "repo");
mkdirSync(join(repo, "apps"), { recursive: true });
// A worktree's .git is a file.
writeFileSync(join(repo, ".git"), "gitdir: elsewhere\n");
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("where the UAT authority's files may go", () => {
  it("finds the checkout a folder is in, a worktree's included", () => {
    expect(repoRootOf(join(repo, "apps"))).toBe(repo);
    expect(repoRootOf(join(base, "elsewhere"))).toBeNull();
  });

  it("refuses the repo and any folder inside it", () => {
    expect(authorityFolderProblem(repo, repo)).toMatch(/inside the repo/);
    expect(authorityFolderProblem(join(repo, "apps", "secrets"), repo)).toMatch(/inside the repo/);
  });

  it("refuses a folder inside another git checkout", () => {
    expect(authorityFolderProblem(join(repo, "apps"), null)).toMatch(/inside a git checkout/);
  });

  it("allows a folder outside every checkout, even one beside the repo", () => {
    expect(authorityFolderProblem(join(base, "uat-secrets"), repo)).toBeNull();
    expect(authorityFolderProblem(join(base, "repo-secrets"), repo)).toBeNull();
  });
});
