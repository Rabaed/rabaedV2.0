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

  it("refuses a migration on a day planning/migration-days.md reserves for another ticket, naming the reservation", () => {
    commit(origin, { "planning/migration-days.md": "| 20261212 | RP-525 | B | review fixes |\n" }, "reserve");
    git(clone, "switch", "-q", "-c", "RP-410-card-layout");
    commit(clone, { [`${dir}/20261212000100_card_layout.sql`]: "-- Card view layout (RP-410).\nselect 3;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261212000100_card_layout.sql");
    expect(result.stderr).toContain("20261212 | RP-525 | B | review fixes");
  });

  it("passes a migration on its own ticket's day, and warns of an unreserved one", () => {
    commit(origin, { "planning/migration-days.md": "| 20261212 | RP-525 | B | review fixes |\n" }, "reserve");
    git(clone, "switch", "-q", "-c", "RP-525-review-fixes");
    commit(clone, { [`${dir}/20261212000000_review_fixes.sql`]: "select 3;\n", [`${dir}/20261213000000_unplanned.sql`]: "select 4;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("20261213000000_unplanned.sql");
  });

  // RP-977: the immutable check runs here too, so it shows before the push, not only in CI:
  // an existing migration edited, and a new one that sorts before main's newest.
  it("fails an existing migration that the branch edits, with the immutable check's message", () => {
    commit(clone, { [`${dir}/20261201000000_start.sql`]: "select 99;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Migrations that already exist on the base branch must not change.");
    expect(result.stderr).toContain(`${dir}/20261201000000_start.sql (edited)`);
  });

  it("fails a new migration that sorts before the latest one on main, with the immutable check's message", () => {
    commit(clone, { [`${dir}/20261205000000_early.sql`]: "select 3;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${dir}/20261205000000_early.sql sorts before 20261210000000_watch.sql, the latest migration on the base branch.`);
  });

  it("says no new migration sorts before main's when all of them sort after", () => {
    commit(clone, { [`${dir}/20261211000000_other.sql`]: "select 3;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("every new migration sorts after the base's latest");
  });

  // RP-990: whatever prints above it, the last line of stdout is the verdict, with the counts.
  const lastLine = (output: string) => output.trimEnd().split("\n").at(-1);

  it("ends with a FAILED verdict counting each kind of refusal, keeping exit code 1", () => {
    commit(clone, { [`${dir}/20261210000000_other.sql`]: "select 3;\n", [`${dir}/20261205000000_early.sql`]: "select 4;\n", [`${dir}/20261201000000_start.sql`]: "select 99;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(1);
    // _other shares _watch's timestamp and sorts before it by name, as _early does by day.
    expect(lastLine(result.stdout)).toBe("check:migrations: FAILED (1 shared timestamp, 1 already on main and changed, 2 sort before main; warning: 2 on a day nobody reserved)");
  });

  it("ends with a passed verdict, with the unreserved-day warning", () => {
    commit(clone, { [`${dir}/20261211000000_other.sql`]: "select 3;\n" }, "branch");
    const result = check();
    expect(result.status).toBe(0);
    expect(lastLine(result.stdout)).toBe("check:migrations: passed (warning: 1 on a day nobody reserved)");
  });

  it("counts a branch redefinition written without seeing the previous one as unseen on this branch, not as on main", () => {
    // Two bodies: a file whose content the other's tree held counts as seen (a rename).
    const fn = "create or replace function app.pick() returns int language sql as $$ select 1 $$;\n";
    commit(clone, { [`${dir}/20261212000000_later.sql`]: fn.replace("select 1", "select 2") }, "first");
    commit(clone, { [`${dir}/20261211000000_earlier.sql`]: fn }, "second");
    const result = check();
    expect(result.status).toBe(1);
    expect(lastLine(result.stdout)).toBe("check:migrations: FAILED (1 redefined unseen on this branch; warning: 2 on a day nobody reserved)");
  });

  it("ends with a FAILED verdict when the fetch fails", () => {
    git(clone, "remote", "set-url", "origin", join(root, "gone"));
    const result = check();
    expect(result.status).not.toBe(0);
    expect(lastLine(result.stdout)).toBe("check:migrations: FAILED (git fetch origin main failed)");
  });

  it("passes on main itself", () => {
    git(clone, "switch", "-q", "main");
    expect(check().status).toBe(0);
  });
});
