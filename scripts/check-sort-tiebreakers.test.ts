import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentUntiedSorts, untiedSorts } from "./check-sort-tiebreakers.ts";
import { migrationsDir } from "./migrations.ts";

const keys = (sql: string) => untiedSorts(sql).map((s) => s.key);

describe("untiedSorts", () => {
  it("finds a sort that ends on a timestamp column, with its line", () => {
    const sql = ["select e.id", "from engineer_sign_in_event e", "order by e.at;"].join("\n");
    expect(untiedSorts(sql)).toEqual([{ line: 3, key: "e.at" }]);
    expect(keys("select id from setup_event order by kind, created_at desc nulls last limit 1;")).toEqual(["created_at"]);
    expect(keys(`select id from x order by "x"."updated_at";`)).toEqual(['"x"."updated_at"']);
  });

  it("passes a sort a unique column ends", () => {
    expect(keys("select id from admin_action order by at, id;")).toEqual([]);
    expect(keys("select id from chat_message c order by c.created_at desc, c.seq desc;")).toEqual([]);
    expect(keys(`select id from work_item_link l join work_item t on t.id = l.to_id order by l.created_at, t.document_number collate "C", l.id;`)).toEqual([]);
  });

  it("passes keys that are no timestamp column", () => {
    expect(keys("select id from work_item order by document_number;")).toEqual([]);
    expect(keys("select id from x order by format, seat;")).toEqual([]);
    expect(keys("select id from x order by coalesce(x.decided_at, x.created_at);")).toEqual([]);
    expect(keys("select id from x order by 2;")).toEqual([]);
  });

  it("checks a window's and an aggregate's order by, ending at their parenthesis", () => {
    expect(keys("select row_number() over (partition by w.project_id order by w.created_at) from work_item w;")).toEqual(["w.created_at"]);
    expect(keys("select jsonb_agg(x.sha order by x.created_at) from documental_record_reproduction x;")).toEqual(["x.created_at"]);
    expect(keys("select jsonb_agg(x.sha order by x.created_at, x.id), max(y) from x order by max(y);")).toEqual([]);
  });

  it("ends a sort at the clause after it, and splits keys only outside parentheses", () => {
    expect(keys("select id from x order by created_at limit 5;")).toEqual(["created_at"]);
    expect(keys("for r in select id from x order by created_at loop end loop;")).toEqual(["created_at"]);
    expect(keys("select id from x order by greatest(a_at, b_at), id;")).toEqual([]);
  });

  it("ignores comments, and takes `-- sort-tiebreaker: <reason>` on the line or the one above as an exception", () => {
    expect(keys("select id from x -- order by created_at\n;")).toEqual([]);
    expect(keys("select id from x /* order by created_at */;")).toEqual([]);
    expect(keys("select id from x order by created_at; -- sort-tiebreaker: one row per item (unique index)")).toEqual([]);
    expect(keys("select id from x\n-- sort-tiebreaker: one row per item (unique index)\norder by created_at;")).toEqual([]);
    // The reason is required.
    expect(keys("select id from x order by created_at; -- sort-tiebreaker:")).toEqual(["created_at"]);
  });

  it("checks dynamic SQL in a literal like any other", () => {
    expect(keys("execute 'select id from x order by at';")).toEqual(["at"]);
  });
});

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
    const dir = join(import.meta.dirname, "..", migrationsDir);
    const migrations = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
    const found = currentUntiedSorts(migrations).map((s) => `${migrationsDir}/${s.file}:${s.line} ${s.function} sorts by ${s.key} last`);
    // Rows sharing a time (one transaction's now()) come back in either order. Rebuild the function in a new migration
    // with a unique last key (`, x.id`, or a seq when write order matters), or say why no two rows can tie in a
    // `-- sort-tiebreaker: <reason>` comment on that line or the one above.
    expect(found).toEqual([]);
  });
});
