import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir as dir } from "./migrations.ts";

// `pnpm check:migrations` (RP-384): fetch origin main, then run the drift check
// on origin/main and HEAD, so a shared timestamp shows before the push.
let root: string;
let origin: string;
let clone: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" }).trim();

function commit(cwd: string, files: Record<string, string>, message: string) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

const check = () => spawnSync("node", [join(import.meta.dirname, "check-migrations.ts")], { cwd: clone, encoding: "utf8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-check-migrations-"));
  origin = join(root, "origin");
  clone = join(root, "clone");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  commit(origin, { [`${dir}/20261201000000_start.sql`]: "select 1;\n" }, "start");
  git(root, "clone", "-q", origin, clone);
  // Main moves after the clone: only the fetch inside the script sees this.
  commit(origin, { [`${dir}/20261210000000_watch.sql`]: "select 2;\n" }, "watch");
  git(clone, "switch", "-q", "-c", "branch");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("check-migrations", () => {
  it("fails on a branch whose migration shares a timestamp with one on main", () => {
    commit(clone, { [`${dir}/20261210000000_other.sql`]: "select 3;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261210000000_watch.sql");
  });

  it("passes on a branch whose migration has a timestamp of its own", () => {
    commit(clone, { [`${dir}/20261211000000_other.sql`]: "select 3;\n" }, "branch");
    expect(check().status).toBe(0);
  });

  it("passes on main itself", () => {
    git(clone, "switch", "-q", "main");
    expect(check().status).toBe(0);
  });
});
