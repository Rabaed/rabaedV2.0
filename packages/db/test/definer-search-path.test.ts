// Seam 2: every SECURITY DEFINER function pins its search_path (RP-287).
// A definer function runs with its owner's rights, so an unpinned search_path
// lets a caller shadow a table or function it uses. Reviews checked this by
// hand (RP-217); this scans the migrations instead.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { definerFunctionsWithoutSearchPath, definerFunctionCount } from "../test-support/definer-functions.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }));

describe("security definer functions in the migrations", () => {
  it("all set search_path", () => {
    const unpinned = migrations.flatMap(({ file, sql }) => definerFunctionsWithoutSearchPath(sql).map((name) => `${name} (${file})`));
    expect(unpinned).toEqual([]);
  });

  it("are found at all (the scan is not blind)", () => {
    expect(migrations.reduce((n, { sql }) => n + definerFunctionCount(sql), 0)).toBeGreaterThan(100);
  });
});

describe("the scan", () => {
  it("names a definer function with no search_path", () => {
    const sql = `create function app.peek() returns int language sql security definer as $$ select 1 $$;`;
    expect(definerFunctionsWithoutSearchPath(sql)).toEqual(["app.peek"]);
  });

  it("passes one that sets it, whatever the order of the clauses", () => {
    const sql = `
      create or replace function app.a() returns int
        language sql stable security definer set search_path = pg_catalog, public
        as $$ select 1 $$;
      create function app.b() returns int set search_path = '' security definer language sql as $$ select 1 $$;`;
    expect(definerFunctionsWithoutSearchPath(sql)).toEqual([]);
  });

  it("ignores invoker functions, comments, and text inside bodies", () => {
    const sql = `
      -- create function app.c() security definer
      create function app.d() returns int language sql as $$ select 1 /* security definer */ $$;
      create function app.e() returns int set search_path = pg_catalog security definer language sql
        as $body$ select 'create function x() security definer' $body$;`;
    expect(definerFunctionsWithoutSearchPath(sql)).toEqual([]);
    expect(definerFunctionCount(sql)).toBe(1);
  });

  it("does not take a later function's search_path for an earlier one's", () => {
    const sql = `
      create function app.f() returns int language sql security definer as $$ select 1 $$;
      create function app.g() returns int language sql security definer set search_path = pg_catalog as $$ select 1 $$;`;
    expect(definerFunctionsWithoutSearchPath(sql)).toEqual(["app.f"]);
  });
});
