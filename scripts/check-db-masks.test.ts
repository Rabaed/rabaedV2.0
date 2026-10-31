import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { apiSourceFiles, maskProblems, type SourceFile } from "./check-db-masks.ts";
import { workingTreeMigrations } from "./migrations.ts";

// RP-1166: an api read that masks what the database hands it (the Owner's review label in place of the
// holder) names the db function that masks the same thing, so a change to one is seen beside the other.

const migration = (name: string, body: string) => ({ name, sql: body });
/** app.holder masks with the Owner's review; app.plain does not. */
const migrations = [
  migration(
    "20270101000000_a.sql",
    `create function app.holder(p uuid) returns uuid language plpgsql as $$
      begin if app.with_owner_review_unchecked(p, '{}') is not null then return null; end if; return p; end $$;
     create function app.plain(p uuid) returns uuid language sql as $$ select p $$;`,
  ),
];
const file = (text: string): SourceFile => ({ path: "apps/api/src/x.ts", text });

describe("maskProblems", () => {
  it("accepts a mask whose comment names a db function that masks the same thing", () => {
    const text = ["const q = sql`", "  -- db-mask: app.holder", "  case when w.owner_review is null then w.holder end", "`;"].join("\n");
    expect(maskProblems([file(text)], migrations)).toEqual([]);
  });

  it("reads the marker on the mask's own line, or a // comment up to three lines above it", () => {
    const own = "select coalesce(app.with_owner_review(w.id), h.name) -- db-mask: app.holder";
    const above = ["// db-mask: app.holder", "// (the label in place of the holder)", "", "x = r.owner_review_name ? lane : r.holder;"].join("\n");
    expect(maskProblems([file(own), file(above)], migrations)).toEqual([]);
  });

  it("names the file and line of a mask with no marker", () => {
    const text = ["const a = 1;", "select coalesce(app.with_owner_review(w.id), h.name)"].join("\n");
    expect(maskProblems([file(text)], migrations)).toEqual([
      "apps/api/src/x.ts:2: masks the holder with the Owner's review label (`with_owner_review(`) with no db function beside it: add a comment `db-mask: app.<function>` for the db function that masks the same thing",
    ]);
  });

  it("does not take a mention in a comment for a mask", () => {
    const text = ["// app.with_owner_review(w.id) gives the label", "/** owner_review is null for the holder */", "  * with_owner_review( in a block"].join("\n");
    expect(maskProblems([file(text)], migrations)).toEqual([]);
  });

  it("refuses a marker naming a function no migration defines", () => {
    const text = "case when w.owner_review is null then w.holder end -- db-mask: app.gone";
    expect(maskProblems([file(text)], migrations)).toEqual(["apps/api/src/x.ts:1: db-mask points at `app.gone`, which nothing in `packages/db/migrations` defines"]);
  });

  it("refuses a marker naming a function whose newest body does not mask it", () => {
    const text = "case when w.owner_review is null then w.holder end -- db-mask: app.plain";
    expect(maskProblems([file(text)], migrations)).toEqual([
      "apps/api/src/x.ts:1: db-mask points at `app.plain`, whose newest body never calls `app.with_owner_review` or `app.with_owner_review_unchecked`, so it does not mask the holder with the Owner's review label",
    ]);
  });

  it("judges the newest definition, not an earlier one", () => {
    const later = [...migrations, migration("20270102000000_b.sql", "create or replace function app.holder(p uuid) returns uuid language sql as $$ select p $$;")];
    const text = "case when w.owner_review is null then w.holder end -- db-mask: app.holder";
    expect(maskProblems([file(text)], later)).toHaveLength(1);
  });
});

describe("the repo", () => {
  it("names a db function beside every mask in apps/api/src (RP-1166)", () => {
    const repo = resolve(import.meta.dirname, "..");
    const files = apiSourceFiles(repo);
    expect(files.length).toBeGreaterThan(50);
    expect(maskProblems(files, workingTreeMigrations(repo))).toEqual([]);
  });
});
