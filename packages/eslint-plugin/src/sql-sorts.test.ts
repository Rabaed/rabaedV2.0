import { describe, expect, it } from "vitest";
import { untiedSorts } from "./sql-sorts.ts";

const keys = (sql: string) => untiedSorts(sql).map((s) => s.key);

describe("untiedSorts (RP-1105)", () => {
  it("finds a sort that ends on a timestamp column, with its line", () => {
    const sql = ["select e.id", "from engineer_sign_in_event e", "order by e.at;"].join("\n");
    expect(untiedSorts(sql)).toEqual([{ line: 3, key: "e.at" }]);
    expect(keys("select id from setup_event order by kind, created_at desc nulls last limit 1;")).toEqual(["created_at"]);
    expect(keys(`select id from x order by "x"."updated_at";`)).toEqual(['"x"."updated_at"']);
    expect(keys("SELECT id FROM x ORDER BY At")).toEqual(["At"]);
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
    expect(keys("select id from x order by $1;")).toEqual([]);
  });

  it("checks a window's and an aggregate's order by, ending at their parenthesis", () => {
    expect(keys("select row_number() over (partition by w.project_id order by w.created_at) from work_item w;")).toEqual(["w.created_at"]);
    expect(keys("select jsonb_agg(x.sha order by x.created_at) from documental_record_reproduction x;")).toEqual(["x.created_at"]);
    expect(keys("select jsonb_agg(x.sha order by x.created_at, x.id), max(y) from x order by max(y);")).toEqual([]);
  });

  it("ends a sort at the clause after it, and splits keys only outside parentheses and literals", () => {
    expect(keys("select id from x order by created_at limit 5;")).toEqual(["created_at"]);
    expect(keys("for r in select id from x order by created_at loop end loop;")).toEqual(["created_at"]);
    expect(keys("select id from x order by greatest(a_at, b_at), id;")).toEqual([]);
    expect(keys("select id from x order by x.kind = 'a,b', created_at;")).toEqual(["created_at"]);
  });

  it("ignores comments, and takes `-- sort-tiebreaker: <reason>` on the line or the one above as an exception", () => {
    expect(keys("select id from x -- order by created_at\n;")).toEqual([]);
    expect(keys("select id from x /* order by created_at */;")).toEqual([]);
    expect(keys("select id from x order by created_at; -- sort-tiebreaker: one row per item (unique index)")).toEqual([]);
    expect(keys("select id from x\n-- sort-tiebreaker: one row per item (unique index)\norder by created_at;")).toEqual([]);
    // The reason is required.
    expect(keys("select id from x order by created_at; -- sort-tiebreaker:")).toEqual(["created_at"]);
  });

  it("reads a sort in dynamic SQL up to the end of its literal", () => {
    expect(keys("execute 'select id from x order by at';")).toEqual(["at"]);
    // The literal's end, not a USING sort operator, ends the key; nor does an argument after the literal.
    expect(keys("return query execute 'select id from x order by at' using v_id;")).toEqual(["at"]);
    expect(keys("execute format('select id from x order by at', v);")).toEqual(["at"]);
    expect(keys("execute format('select id from x order by at, id', v_at);")).toEqual([]);
  });
});
