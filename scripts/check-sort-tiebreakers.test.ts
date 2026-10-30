import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentUntiedSorts } from "./check-sort-tiebreakers.ts";
import { migrationsDir, workingTreeMigrations } from "./migrations.ts";

// How one sort is read is tested in packages/eslint-plugin/src/sql-sorts.test.ts.

describe("currentUntiedSorts", () => {
  const create = (name: string, body: string) => `create or replace function app.${name}() returns setof uuid language sql as $$ ${body} $$;`;

  it("judges each function by its newest definition only", () => {
    const migrations = [
      { name: "20260101000000_a.sql", sql: create("events", "select id from admin_action order by at") },
      { name: "20260102000000_b.sql", sql: create("events", "select id from admin_action order by at, id") },
      { name: "20260103000000_c.sql", sql: create("log", "select id from setup_event order by created_at") },
    ];
    expect(currentUntiedSorts(migrations)).toEqual([{ file: "20260103000000_c.sql", line: 1, function: "app.log", key: "created_at" }]);
  });

  it("brings back a fixed sort a later definition undoes", () => {
    const migrations = [
      { name: "20260101000000_a.sql", sql: create("events", "select id from admin_action order by at, id") },
      { name: "20260102000000_b.sql", sql: create("events", "select id from admin_action order by at") },
    ];
    expect(currentUntiedSorts(migrations)).toEqual([{ file: "20260102000000_b.sql", line: 1, function: "app.events", key: "at" }]);
  });

  it("drops a function its migration dropped", () => {
    const migrations = [
      { name: "20260101000000_a.sql", sql: create("events", "select id from admin_action order by at") },
      { name: "20260102000000_b.sql", sql: "drop function app.events();" },
    ];
    expect(currentUntiedSorts(migrations)).toEqual([]);
  });

  it("gives the line within the migration", () => {
    const migrations = [{ name: "20260101000000_a.sql", sql: `-- one\n-- two\n${create("events", "select id\n from admin_action\n order by at")}` }];
    expect(currentUntiedSorts(migrations)).toEqual([{ file: "20260101000000_a.sql", line: 5, function: "app.events", key: "at" }]);
  });
});

describe("the app.* functions in packages/db/migrations (RP-1105)", () => {
  it("end every sort on a unique column, not a timestamp", () => {
    const found = currentUntiedSorts(workingTreeMigrations(join(import.meta.dirname, ".."))).map(
      (s) => `${migrationsDir}/${s.file}:${s.line} ${s.function} sorts by ${s.key} last`,
    );
    // Rows sharing a time (one transaction's now()) come back in either order. Rebuild the function in a new migration
    // with a unique last key (`, x.id`, or a seq when write order matters), or say why no two rows can tie in a
    // `-- sort-tiebreaker: <reason>` comment on that line or the one above.
    expect(found).toEqual([]);
  });
});
