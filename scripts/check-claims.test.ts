import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Comment } from "./claims.ts";
import { branchChanges, branchKey, checkClaims, laneOwner, type ClaimsInput } from "./check-claims.ts";

// RP-603's comments are stubbed; the shared-files list is the real one in docs/agents/issue-tracker.md.
const sharedList = readFileSync(join(import.meta.dirname, "..", "docs", "agents", "issue-tracker.md"), "utf8");
const comment = (id: number, text: string): Comment => ({ id, created: "2026-10-20T10:00:00.000+0300", text });

function input(overrides: Partial<ClaimsInput>): ClaimsInput {
  return { key: "RP-1100", files: [], redefined: [], sharedList, comments: async () => [], ...overrides };
}

describe("checkClaims", () => {
  it("refuses a branch changing the work item query with no open claim for its key, naming the file", async () => {
    const result = await checkClaims(input({ files: ["apps/api/src/work-items/query.ts", "apps/api/src/other.ts"], comments: async () => [comment(1, "CLAIM `apps/api/src/work-items/query.ts` — Main 2, lane-2c, RP-998")] }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("apps/api/src/work-items/query.ts");
    expect(result.message).not.toContain("apps/api/src/other.ts");
    expect(result.message).toContain("CLAIM `apps/api/src/work-items/query.ts` — Main <m>, lane-<mx>, RP-1100");
  });

  it("passes with a matching open CLAIM, under a directory or glob claim too, and with the key in the claim's header", async () => {
    const files = ["apps/api/src/work-items/query.ts", "packages/db/test-support/tower.ts", "scripts/lanes-prune.ts"];
    const claims = [
      comment(1, "CLAIM `apps/api/src/work-items/query.ts` (`matching` only) — Main 3, lane-3a, RP-1100"),
      comment(2, "CLAIM `packages/db/test-support/` (add only) — Main 3, lane-3a, RP-1100"),
      comment(3, "CLAIM for RP-1100, branch `RP-1100-x` — Main 3, lane-3a. `scripts/lanes*.ts`, see RP-589-3"),
    ];
    expect(await checkClaims(input({ files, comments: async () => claims }))).toEqual({ ok: true, message: "" });
  });

  it("does not count a released claim, or another key's open claim on the file", async () => {
    const files = ["apps/api/src/work-items/query.ts"];
    const released = [comment(1, "CLAIM `apps/api/src/work-items/query.ts` — Main 3, lane-3a, RP-1100"), comment(2, "RELEASE `apps/api/src/work-items/query.ts` — RP-1100 (PR #9)")];
    expect((await checkClaims(input({ files, comments: async () => released }))).ok).toBe(false);
    const another = [comment(1, "CLAIM `apps/api/src/work-items/query.ts` — Main 4, lane-4a, RP-577; RP-1100 merges after")];
    expect((await checkClaims(input({ files, comments: async () => another }))).ok).toBe(false);
    for (const near of ["RP-110", "RP-11000", "RP-1100-2"]) {
      const header = [comment(1, `CLAIM for ${near}: \`apps/api/src/work-items/query.ts\` — Main 4, lane-4a`)];
      expect((await checkClaims(input({ files, comments: async () => header }))).ok, near).toBe(false);
    }
  });

  it("passes silently a branch touching no shared module, without reading RP-603", async () => {
    let read = false;
    const comments = async () => ((read = true), []);
    // `tower.ts` alone and `app.cancel_allowed` are named in the doc, but not as shared modules.
    const files = ["apps/api/src/packages/packages.ts", "apps/web/src/app/page.tsx", "docs/data-model.md", "tower.ts", "scripts/lanes-claims-notes.md"];
    expect(await checkClaims(input({ files, comments }))).toEqual({ ok: true, message: "" });
    expect(read).toBe(false);
  });

  it("refuses an app.* function a branch migration redefines with no claim naming it", async () => {
    const comments = async () => [comment(1, "CLAIM `app.take_transition` — Main 3, lane-3a, RP-1100")];
    const result = await checkClaims(input({ redefined: ["app.take_transition", "app.sync_work_item_checklists"], comments }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("  app.sync_work_item_checklists");
    expect(result.message).not.toContain("  app.take_transition");
  });

  it("warns and passes when RP-603 can't be read (no network or no credentials)", async () => {
    const comments = async (): Promise<Comment[]> => {
      throw new Error("fetch failed");
    };
    const result = await checkClaims(input({ files: ["apps/api/src/work-items/query.ts"], comments }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Warning: check:claims could not read RP-603 (fetch failed)");
    expect(result.message).toContain("apps/api/src/work-items/query.ts");
  });

  it("fills the claim line's Main and lane from the lane's compose project when known", async () => {
    const result = await checkClaims(input({ files: ["package.json"], owner: laneOwner("COMPOSE_PROJECT_NAME=rabaed-lane31\nPORT=3310\n") }));
    expect(result.message).toContain("CLAIM `package.json` — Main 3, lane-3a, RP-1100");
    expect(laneOwner("PORT=3000\n")).toBeUndefined();
  });

  it("refuses a shared change on a branch whose name has no key, and says to name it", async () => {
    const result = await checkClaims(input({ key: undefined, files: ["package.json"] }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("the branch has no issue key in front");
    expect(result.message).toContain("  package.json");
  });
});

describe("branchKey", () => {
  it("reads the key a branch name starts with, upper-cased", () => {
    expect(branchKey("RP-1008-check-claims")).toBe("RP-1008");
    expect(branchKey("refs/heads/rp-956-prune-tooling")).toBe("RP-956");
    expect(branchKey("claude/eager-archimedes-47466d")).toBeUndefined();
  });
});

describe("branchChanges", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    return git("rev-parse", "HEAD");
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-check-claims-repo-"));
    git("init", "-q", "-b", "main");
    write("packages/db/migrations/20270101000000_engine.sql", "create or replace function app.take_transition(p uuid) returns void as $$ $$;\nCREATE FUNCTION app.sync_work_item_checklists() returns void as $$ $$;\n");
    git("update-ref", "refs/remotes/origin/main", commit());
    git("checkout", "-q", "-b", "RP-1100-x");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("lists the files changed since origin/main and the app.* functions a branch migration redefines, not the new ones", () => {
    write("packages/db/migrations/20271101000000_x.sql", "Create Or Replace Function app.sync_work_item_checklists() returns void as $$ $$;\ncreate or replace function app.brand_new() returns void as $$ $$;\n");
    write("apps/api/src/work-items/query.ts", "export {};\n");
    const pushed = commit();
    expect(branchChanges(repo, pushed)).toEqual({ files: ["apps/api/src/work-items/query.ts", "packages/db/migrations/20271101000000_x.sql"], redefined: ["app.sync_work_item_checklists"] });
  });

  it("reads a quoted name and a head across lines as the same function", () => {
    write("packages/db/migrations/20271101000000_x.sql", 'create or replace function "app"."take_transition"(p uuid) returns void as $$ $$;\ncreate or replace\n  function app."sync_work_item_checklists"() returns void as $$ $$;\n');
    expect(branchChanges(repo, commit()).redefined).toEqual(["app.sync_work_item_checklists", "app.take_transition"]);
  });

  it("without a commit, reads the working tree, untracked files included", () => {
    write("packages/db/migrations/20271101000000_x.sql", "create or replace function app.take_transition(p uuid) returns void as $$ $$;\n");
    expect(branchChanges(repo)).toEqual({ files: ["packages/db/migrations/20271101000000_x.sql"], redefined: ["app.take_transition"] });
  });
});
