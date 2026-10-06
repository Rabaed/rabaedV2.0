import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alteredMigrations, misorderedMigrations } from "./check-migrations-immutable.ts";
import { migrationsDir as dir } from "./migrations.ts";

// A throwaway repository: `main` with one migration, then a branch off it.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo });

function commit(files: Record<string, string>, message = "change") {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-migrations-repo-"));
  git("init", "-q", "-b", "main");
  commit({ [`${dir}/20260928150000_a.sql`]: "create table a ();\n" }, "start");
  git("switch", "-q", "-c", "change");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("alteredMigrations", () => {
  it("passes when the change only adds a new migration", () => {
    commit({ [`${dir}/20260929000000_b.sql`]: "create table b ();\n", "docs/note.md": "x" });
    expect(alteredMigrations(repo, "main")).toEqual([]);
  });

  it("passes when nothing under migrations changed", () => {
    commit({ "README.md": "x" });
    expect(alteredMigrations(repo, "main")).toEqual([]);
  });

  it("fails when an existing migration is edited, even by a byte", () => {
    commit({ [`${dir}/20260928150000_a.sql`]: "create table a ();\n\n" });
    expect(alteredMigrations(repo, "main")).toEqual([`${dir}/20260928150000_a.sql (edited)`]);
  });

  it("fails when an existing migration is deleted or renamed", () => {
    git("mv", `${dir}/20260928150000_a.sql`, `${dir}/20260928150000_renamed.sql`);
    git("commit", "-q", "-m", "rename");
    expect(alteredMigrations(repo, "main")).toEqual([
      `${dir}/20260928150000_a.sql (deleted or renamed)`,
    ]);
  });

  it("passes an edit that a later commit reverts (only the end state counts)", () => {
    commit({ [`${dir}/20260928150000_a.sql`]: "changed\n" });
    commit({ [`${dir}/20260928150000_a.sql`]: "create table a ();\n" });
    expect(alteredMigrations(repo, "main")).toEqual([]);
  });

  it("is not fooled by main moving on after the branch was made", () => {
    git("switch", "-q", "main");
    commit({ [`${dir}/20260930000000_c.sql`]: "create table c ();\n" }, "another merge");
    git("switch", "-q", "change");
    commit({ [`${dir}/20260929000000_b.sql`]: "create table b ();\n" });
    expect(alteredMigrations(repo, "main")).toEqual([]);
  });
});

describe("misorderedMigrations", () => {
  it("passes a new migration that sorts after the base's latest", () => {
    commit({ [`${dir}/20260929000000_b.sql`]: "create table b ();\n" });
    expect(misorderedMigrations(repo, "main")).toEqual([]);
  });

  it("fails a new migration that sorts before a migration main gained after the branch was made", () => {
    git("switch", "-q", "main");
    commit({ [`${dir}/20260930000000_c.sql`]: "create table c ();\n" }, "another merge");
    git("switch", "-q", "change");
    commit({ [`${dir}/20260929000000_b.sql`]: "create table b ();\n" });
    expect(misorderedMigrations(repo, "main")).toEqual([{ path: `${dir}/20260929000000_b.sql`, latest: "20260930000000_c.sql" }]);
  });

  it("passes once the new migration is renamed to sort after the base's latest", () => {
    git("switch", "-q", "main");
    commit({ [`${dir}/20260930000000_c.sql`]: "create table c ();\n" }, "another merge");
    git("switch", "-q", "change");
    commit({ [`${dir}/20261001000000_b.sql`]: "create table b ();\n" });
    expect(misorderedMigrations(repo, "main")).toEqual([]);
  });

  it("fails a new migration that sorts before the base's latest", () => {
    commit({ [`${dir}/20260927000000_b.sql`]: "create table b ();\n" });
    expect(misorderedMigrations(repo, "main")).toEqual([{ path: `${dir}/20260927000000_b.sql`, latest: "20260928150000_a.sql" }]);
  });

  it("ignores changes outside migrations", () => {
    commit({ "README.md": "x" });
    expect(misorderedMigrations(repo, "main")).toEqual([]);
  });
});
