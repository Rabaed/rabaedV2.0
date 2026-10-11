import { describe, expect, it } from "vitest";
import { currentDefinitions, findDefinitions, report } from "./db-fn.ts";

const fn = (body: string, args = "p_id uuid") => `-- create or replace function app.hit(uuid) is a comment
create or replace function app.hit(${args}) returns text language sql as $$ select '${body}'; $$;
grant execute on function app.hit(uuid) to app;
`;

const three = [
  { name: "20260101000000_a.sql", sql: fn("first") },
  { name: "20260301000000_c.sql", sql: `select 1;\n\n${fn("third")}` },
  { name: "20260201000000_b.sql", sql: fn("second") },
];

describe("db:fn", () => {
  it("prints the third of three definitions, by file order", () => {
    const { out, found } = report(findDefinitions(three, "app.hit"), "hit", false);
    expect(found).toBe(true);
    expect(out).toContain("20260301000000_c.sql:4");
    expect(out).toContain("select 'third'");
    expect(out).not.toContain("select 'second'");
    expect(out).not.toContain("grant execute");
  });

  it("takes the name with or without app. and in any case", () => {
    expect(findDefinitions(three, "HIT")).toHaveLength(3);
    expect(findDefinitions(three, "app.hit")).toHaveLength(3);
  });

  it("lists every definition in order", () => {
    const { out } = report(findDefinitions(three, "hit"), "hit", true);
    const rows = out.split("\n").slice(1);
    expect(rows.map((r) => /_(\w)\.sql/.exec(r)?.[1])).toEqual(["a", "b", "c"]);
  });

  it("says so for an unknown name", () => {
    const { out, found } = report(findDefinitions(three, "nope"), "nope", false);
    expect(found).toBe(false);
    expect(out).toBe("Nothing in packages/db/migrations defines app.nope.");
  });

  it("ignores commented-out definitions and keeps semicolons inside the body", () => {
    const [d] = findDefinitions([{ name: "1.sql", sql: fn("a;b") }], "hit");
    expect(d!.line).toBe(2);
    expect(d!.text.endsWith("$$;")).toBe(true);
    expect(d!.text).toContain("a;b");
  });

  it("shows each overload's newest definition, and none after a drop", () => {
    const defs = findDefinitions(
      [
        { name: "1.sql", sql: fn("old", "p_id uuid, p_reason text") },
        { name: "2.sql", sql: fn("new", "p_id uuid, p_answers jsonb") },
        { name: "3.sql", sql: "drop function app.hit(uuid, text);" },
      ],
      "hit",
    );
    const current = currentDefinitions(defs);
    expect(current).toHaveLength(1);
    expect(current[0]!.file).toBe("2.sql");
    const dropped = findDefinitions([{ name: "1.sql", sql: fn("x") }, { name: "2.sql", sql: "drop function app.hit;" }], "hit");
    expect(report(dropped, "hit", false).out).toContain("was dropped");
  });
});
