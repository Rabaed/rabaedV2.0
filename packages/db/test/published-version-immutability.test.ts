// Seam 2 catalogue test (RP-453; ADR 0016): every table that hangs off a published Version
// (a foreign key to workflow_version, form_version or screen_version, or to a Workflow
// Step or Transition, which belong to one) is frozen on INSERT, UPDATE and DELETE.
//
// RP-424 first guarded UPDATE and DELETE only, so a Step could still be added to a
// published Version; review caught it. This test reads pg_catalog so the next table that
// hangs off a Version can't miss the guard the same way: it goes red until the table has a
// BEFORE row trigger for INSERT, UPDATE and DELETE that refuses a published Version, or is
// listed in EXCUSED below with the reason, which is a reviewed choice.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const name = JSON.stringify({ en: "Frozen", ar: "مجمد" });

// What a table's foreign key can point at to make it part of, or pinned to, a Version.
const VERSION_PARENTS = ["workflow_version", "form_version", "screen_version", "workflow_step", "workflow_transition"];
// The tables that are a Version themselves: UPDATE and DELETE are refused once published.
const VERSION_TABLES = ["workflow_version", "form_version", "screen_version"];
// Trigger functions that refuse a published Version, besides any trigger named *_published_frozen.
const KNOWN_GUARD_FUNCTIONS = ["app.refuse_published_workflow_part_change", "app.refuse_published_workflow_version_change"];

type Operation = "insert" | "update" | "delete";
type Excuse = { reason: string; guards?: Operation[] };

// Tables with a foreign key to a Version (or its Steps or Transitions) that are not part of
// it. `guards` lists the operations that are still guarded and checked.
const EXCUSED: Record<string, Excuse> = {
  work_item: { reason: "pins the Version it runs on (ADR 0016); it is an instance, not part of the Version" },
  work_item_event: { reason: "an Item's append-only history names the Steps and Transition it went through" },
  notification: { reason: "an instance row: a notification about a Step an Item reached" },
  step_assignment: { reason: "an instance row: who holds an Item at a Step" },
  workflow_change_note: {
    reason: "written once, in the transaction that publishes the Version (primary key = the Version), so INSERT stays open",
    guards: ["update", "delete"],
  },
};

type TriggerRow = { tgname: string; tgtype: number; fn: string; enabled: string };
type Catalogue = Map<string, { parents: Set<string>; triggers: TriggerRow[] }>;

let migrator: pg.Client;
let catalogue: Catalogue;
const one = async (text: string, values: unknown[] = []) => (await migrator.query(text, values)).rows[0].id as string;
const refused = (text: string, values: unknown[]) =>
  expect(migrator.query(text, values)).rejects.toMatchObject({ code: "42501" });

async function readCatalogue(): Promise<Catalogue> {
  const result: Catalogue = new Map();
  const { rows: links } = await migrator.query(
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
     from pg_constraint c
     where c.contype = 'f' and c.confrelid::regclass::text = any($1) and c.connamespace = 'public'::regnamespace
     order by 1, 2`,
    [VERSION_PARENTS],
  );
  for (const { child, parent } of links) {
    const entry = result.get(child) ?? { parents: new Set<string>(), triggers: [] };
    entry.parents.add(parent);
    result.set(child, entry);
  }
  for (const [child, entry] of result) {
    const { rows } = await migrator.query(
      `select t.tgname, t.tgtype::int as tgtype, t.tgfoid::regproc::text as fn, t.tgenabled as enabled
       from pg_trigger t where t.tgrelid = $1::regclass and not t.tgisinternal order by t.tgname`,
      [child],
    );
    entry.triggers = rows;
  }
  return result;
}

// BEFORE (2) + ROW (1), and the operation bits: INSERT 4, DELETE 8, UPDATE 16.
const BIT: Record<Operation, number> = { insert: 4, delete: 8, update: 16 };
const isGuard = (t: TriggerRow) =>
  t.enabled !== "D" && (t.tgname.endsWith("_published_frozen") || KNOWN_GUARD_FUNCTIONS.includes(t.fn));
const guardedOperations = (triggers: TriggerRow[]): Operation[] =>
  (Object.keys(BIT) as Operation[]).filter((op) =>
    triggers.some((t) => isGuard(t) && (t.tgtype & 1) === 1 && (t.tgtype & 2) === 2 && (t.tgtype & BIT[op]) === BIT[op]),
  );

type Fixture = { version: string; fromStep: string; toStep: string };
let published: Fixture;

// One INSERT per guarded table that points at the published Version. A table that is guarded
// but not listed here fails the test: write its row here too, so it is tried for real.
const INSERTS: Record<string, (f: Fixture) => [string, unknown[]]> = {
  workflow_step: (f) => [
    `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule) values ($1, 'extra', $2, 'draft', '{}')`,
    [f.version, name],
  ],
  workflow_transition: (f) => [
    `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
     values ($1, 'extra', $2, $3, $4, 'send', 'create')`,
    [f.version, f.fromStep, f.toStep, name],
  ],
};

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  catalogue = await readCatalogue();
  const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
  const version = await one(
    "insert into workflow_version (workflow_definition_id, version_no, status) values ($1, 1, 'draft') returning id",
    [definition],
  );
  const step = (key: string) =>
    one(
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule) values ($1, $2, $3, 'draft', '{}') returning id`,
      [version, key, name],
    );
  const fromStep = await step("first");
  const toStep = await step("second");
  await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [version]);
  await migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'first')", [version]);
  published = { version, fromStep, toStep };
});

afterAll(async () => {
  await migrator?.end();
});

describe("tables that hang off a Version", () => {
  it("finds the tables the guards were written for", () => {
    expect([...catalogue.keys()]).toEqual(expect.arrayContaining(["workflow_step", "workflow_transition", "work_item"]));
  });

  it("each has a before-row guard on INSERT, UPDATE and DELETE, or is excused with a reason", () => {
    const gaps: string[] = [];
    for (const [table, { parents, triggers }] of catalogue) {
      const have = guardedOperations(triggers);
      const excuse = EXCUSED[table];
      const need: Operation[] = excuse ? (excuse.guards ?? []) : ["insert", "update", "delete"];
      const missing = need.filter((op) => !have.includes(op));
      if (missing.length > 0) {
        gaps.push(`${table} (foreign key to ${[...parents].join(", ")}) has no before-row guard on ${missing.join(", ")}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("lists no excuse for a table that no longer hangs off a Version", () => {
    expect(Object.keys(EXCUSED).filter((table) => !catalogue.has(table))).toEqual([]);
  });

  it("gives every excuse a reason", () => {
    for (const [table, excuse] of Object.entries(EXCUSED)) {
      expect(excuse.reason.length, table).toBeGreaterThan(10);
    }
  });

  it("has Version tables that refuse UPDATE and DELETE once published", async () => {
    for (const table of VERSION_TABLES) {
      const { rows } = await migrator.query(
        `select t.tgname, t.tgtype::int as tgtype, t.tgfoid::regproc::text as fn, t.tgenabled as enabled
         from pg_trigger t where t.tgrelid = $1::regclass and not t.tgisinternal`,
        [table],
      );
      expect(guardedOperations(rows), table).toEqual(expect.arrayContaining(["update", "delete"]));
    }
  });
});

describe("a published Version, behaviour per guarded table", () => {
  it("refuses an INSERT of a row pointing at it with 42501", async () => {
    const guarded = [...catalogue].filter(([table, { triggers }]) => !EXCUSED[table] && guardedOperations(triggers).includes("insert"));
    expect(guarded.map(([table]) => table).sort()).toEqual(expect.arrayContaining(["workflow_step", "workflow_transition"]));
    for (const [table] of guarded) {
      const insert = INSERTS[table];
      expect(insert, `no INSERT fixture for ${table}: add one to INSERTS`).toBeDefined();
      const [text, values] = insert!(published);
      await refused(text, values);
    }
  });

  it("refuses an UPDATE or DELETE of a Change Note with 42501", async () => {
    await refused("update workflow_change_note set change_note = 'changed' where workflow_version_id = $1", [published.version]);
    await refused("delete from workflow_change_note where workflow_version_id = $1", [published.version]);
  });

  it("still lets a Version's Change Note be written once, at publish", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const version = await one(
      "insert into workflow_version (workflow_definition_id, version_no, status) values ($1, 1, 'draft') returning id",
      [definition],
    );
    await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [version]);
    await migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'once')", [version]);
    await expect(
      migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'twice')", [version]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
