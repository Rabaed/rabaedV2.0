// Seam 2 catalogue test (RP-453; ADR 0016): every table that hangs off a published Version
// (a foreign key to workflow_version, form_version or screen_version, or to a Workflow
// Step or Transition, which belong to one) is frozen on INSERT, UPDATE and DELETE.
//
// RP-424 first guarded UPDATE and DELETE only, so a Step could still be added to a
// published Version; review caught it. This test reads pg_catalog so the next table that
// hangs off a Version can't miss the guard the same way: it goes red until the table has a
// BEFORE row trigger for INSERT, UPDATE and DELETE that refuses a published Version, or is
// listed in EXCUSED below with the reason, which is a reviewed choice. A trigger's name is
// not taken on trust: each guarded operation is tried for real on a published Version's
// row (FIXTURES) and must be refused with 42501, so a no-op `*_published_frozen` fails.
//
// Everything runs in one transaction that is rolled back at the end, so the fixtures leave
// no rows behind; each refused statement runs in its own savepoint.
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
const ALL: Operation[] = ["insert", "update", "delete"];
type Excuse = { reason: string; guards?: Operation[] };

// Tables with a foreign key to a Version (or its Steps or Transitions) that are not part of
// it. `guards` lists the operations that are still guarded and checked.
const EXCUSED: Record<string, Excuse> = {
  work_item: { reason: "pins the Version it runs on (ADR 0016); it is an instance, not part of the Version" },
  work_item_event: { reason: "an Item's append-only history names the Steps and Transition it went through" },
  notification: { reason: "an instance row: a notification about a Step an Item reached" },
  step_assignment: { reason: "an instance row: who holds an Item at a Step" },
  submittal_register_import_row: {
    reason: "an instance row (RP-639): a previewed register row names the Form Version its answers were checked against",
  },
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

let savepoints = 0;
/** Runs `text` in a savepoint and rolls back to it, so a refusal doesn't end the transaction; returns its error code, or null when it ran. */
async function attempt(text: string, values: unknown[]): Promise<string | null> {
  const savepoint = `attempt_${++savepoints}`;
  await migrator.query(`savepoint ${savepoint}`);
  try {
    await migrator.query(text, values);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  } finally {
    await migrator.query(`rollback to savepoint ${savepoint}`);
  }
}

async function triggersOn(table: string): Promise<TriggerRow[]> {
  const { rows } = await migrator.query(
    `select t.tgname, t.tgtype::int as tgtype, t.tgfoid::regproc::text as fn, t.tgenabled as enabled
     from pg_trigger t where t.tgrelid = $1::regclass and not t.tgisinternal order by t.tgname`,
    [table],
  );
  return rows;
}

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
  for (const [child, entry] of result) entry.triggers = await triggersOn(child);
  return result;
}

// BEFORE (2) + ROW (1), and the operation bits: INSERT 4, DELETE 8, UPDATE 16.
const BIT: Record<Operation, number> = { insert: 4, delete: 8, update: 16 };
const isGuard = (t: TriggerRow) =>
  t.enabled !== "D" && (t.tgname.endsWith("_published_frozen") || KNOWN_GUARD_FUNCTIONS.includes(t.fn));
const guardedOperations = (triggers: TriggerRow[]): Operation[] =>
  ALL.filter((op) => triggers.some((t) => isGuard(t) && (t.tgtype & 1) === 1 && (t.tgtype & 2) === 2 && (t.tgtype & BIT[op]) === BIT[op]));

/** The operations a table off a Version must refuse on a published one: all three, or what its excuse still guards. */
const needed = (table: string): Operation[] => (EXCUSED[table] ? (EXCUSED[table].guards ?? []) : ALL);

/** Every table off a Version without a guard trigger for an operation it needs, as "table (...) has no before-row guard on ...". */
function catalogueGaps(of: Catalogue): string[] {
  const gaps: string[] = [];
  for (const [table, { parents, triggers }] of of) {
    const have = guardedOperations(triggers);
    const missing = needed(table).filter((op) => !have.includes(op));
    if (missing.length > 0) gaps.push(`${table} (foreign key to ${[...parents].join(", ")}) has no before-row guard on ${missing.join(", ")}`);
  }
  return gaps;
}

type Published = { workflowVersion: string; fromStep: string; toStep: string; transition: string; formVersion: string; screenVersion: string };
type Statement = [string, unknown[]];
type Fixture = Partial<Record<Operation, (p: Published) => Statement>>;

// One statement per guarded table and operation, each on a row of (or pointing at) a
// published Version. A table that must refuse an operation and has no statement here fails
// the test: write it here too, so the guard is tried for real.
const FIXTURES: Record<string, Fixture> = {
  workflow_version: {
    update: (p) => ["update workflow_version set version_no = version_no + 100 where id = $1", [p.workflowVersion]],
    delete: (p) => ["delete from workflow_version where id = $1", [p.workflowVersion]],
  },
  form_version: {
    update: (p) => [`update form_version set schema = '{"sections": [{}]}' where id = $1`, [p.formVersion]],
    delete: (p) => ["delete from form_version where id = $1", [p.formVersion]],
  },
  screen_version: {
    update: (p) => [`update screen_version set schema = '{"changed": true}' where id = $1`, [p.screenVersion]],
    delete: (p) => ["delete from screen_version where id = $1", [p.screenVersion]],
  },
  workflow_step: {
    insert: (p) => [
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule) values ($1, 'extra', $2, 'draft', '{}')`,
      [p.workflowVersion, name],
    ],
    update: (p) => ["update workflow_step set key = 'renamed' where id = $1", [p.fromStep]],
    delete: (p) => ["delete from workflow_step where id = $1", [p.toStep]],
  },
  workflow_transition: {
    insert: (p) => [
      `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
       values ($1, 'extra', $2, $3, $4, 'send', 'create')`,
      [p.workflowVersion, p.fromStep, p.toStep, name],
    ],
    update: (p) => ["update workflow_transition set key = 'renamed' where id = $1", [p.transition]],
    delete: (p) => ["delete from workflow_transition where id = $1", [p.transition]],
  },
  workflow_change_note: {
    update: (p) => ["update workflow_change_note set change_note = 'changed' where workflow_version_id = $1", [p.workflowVersion]],
    delete: (p) => ["delete from workflow_change_note where workflow_version_id = $1", [p.workflowVersion]],
  },
};

/** Each needed operation on each table, tried on the published Version; returns every one that wasn't refused with 42501. */
async function behaviourGaps(tables: string[], fixtures: Record<string, Fixture>, needs: (table: string) => Operation[]): Promise<string[]> {
  const gaps: string[] = [];
  for (const table of tables) {
    for (const op of needs(table)) {
      const statement = fixtures[table]?.[op];
      if (!statement) {
        gaps.push(`${table}: no ${op} fixture; add one to FIXTURES`);
        continue;
      }
      const code = await attempt(...statement(published));
      if (code !== "42501") gaps.push(`${table}: ${op} on a published Version gave ${code ?? "no error"}, not 42501`);
    }
  }
  return gaps;
}

let published: Published;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  await migrator.query("begin");
  catalogue = await readCatalogue();

  const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
  const workflowVersion = await one(
    "insert into workflow_version (workflow_definition_id, version_no, status) values ($1, 1, 'draft') returning id",
    [definition],
  );
  const step = (key: string) =>
    one(
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule) values ($1, $2, $3, 'draft', '{}') returning id`,
      [workflowVersion, key, name],
    );
  const fromStep = await step("first");
  const toStep = await step("second");
  const transition = await one(
    `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
     values ($1, 'onward', $2, $3, $4, 'send', 'create') returning id`,
    [workflowVersion, fromStep, toStep, name],
  );
  await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [workflowVersion]);
  await migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'first')", [workflowVersion]);

  const form = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
  const formVersion = await one(
    `insert into form_version (form_definition_id, version_no, status, schema, published_at)
     values ($1, 1, 'published', '{"sections": []}', now()) returning id`,
    [form],
  );
  const screen = await one("insert into screen (owner_kind, key, name) values ('rabaed', 'rp453_frozen', $1) returning id", [name]);
  const screenVersion = await one(
    `insert into screen_version (screen_id, version_no, status, schema, published_at) values ($1, 1, 'published', '{}', now()) returning id`,
    [screen],
  );
  published = { workflowVersion, fromStep, toStep, transition, formVersion, screenVersion };
});

afterAll(async () => {
  await migrator?.query("rollback");
  await migrator?.end();
});

describe("tables that hang off a Version", () => {
  it("finds the tables the guards were written for", () => {
    expect([...catalogue.keys()]).toEqual(expect.arrayContaining(["workflow_step", "workflow_transition", "work_item"]));
  });

  it("each has a before-row guard on INSERT, UPDATE and DELETE, or is excused with a reason", () => {
    expect(catalogueGaps(catalogue)).toEqual([]);
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
      expect(guardedOperations(await triggersOn(table)), table).toEqual(expect.arrayContaining(["update", "delete"]));
    }
  });

  // The check run red once, for real: a new table off workflow_version with no guard,
  // created and dropped inside this test's savepoint.
  it("goes red for a new table off a Version with no guard", async () => {
    await migrator.query("savepoint unguarded");
    try {
      await migrator.query("create table rp453_unguarded (id int primary key, workflow_version_id uuid references workflow_version (id))");
      expect(catalogueGaps(await readCatalogue())).toEqual([
        "rp453_unguarded (foreign key to workflow_version) has no before-row guard on insert, update, delete",
      ]);
    } finally {
      await migrator.query("rollback to savepoint unguarded");
    }
  });
});

describe("a published Version, behaviour per guarded table", () => {
  const versionNeeds = (table: string): Operation[] => (VERSION_TABLES.includes(table) ? ["update", "delete"] : needed(table));

  it("refuses every guarded INSERT, UPDATE and DELETE on it with 42501", async () => {
    const tables = [...VERSION_TABLES, ...catalogue.keys()];
    expect(tables).toEqual(expect.arrayContaining(["workflow_step", "workflow_transition", "workflow_change_note"]));
    expect(await behaviourGaps(tables, FIXTURES, versionNeeds)).toEqual([]);
  });

  // A trigger named like a guard that refuses nothing passes the catalogue check; the
  // behaviour check must catch it.
  it("goes red for a guard trigger that refuses nothing", async () => {
    await migrator.query("savepoint no_op_guard");
    try {
      await migrator.query("create table rp453_no_op (id int primary key, workflow_version_id uuid references workflow_version (id))");
      await migrator.query("create function public.rp453_no_op() returns trigger language plpgsql as $$ begin return case when tg_op = 'DELETE' then old else new end; end $$");
      await migrator.query(
        "create trigger rp453_no_op_published_frozen before insert or update or delete on rp453_no_op for each row execute function public.rp453_no_op()",
      );
      expect(catalogueGaps(await readCatalogue())).toEqual([]);
      await migrator.query("insert into rp453_no_op values (1, $1)", [published.workflowVersion]);
      const fixtures: Record<string, Fixture> = {
        rp453_no_op: {
          insert: (p) => ["insert into rp453_no_op values (2, $1)", [p.workflowVersion]],
          update: () => ["update rp453_no_op set id = 3 where id = 1", []],
          delete: () => ["delete from rp453_no_op where id = 1", []],
        },
      };
      expect(await behaviourGaps(["rp453_no_op"], fixtures, () => ALL)).toEqual([
        "rp453_no_op: insert on a published Version gave no error, not 42501",
        "rp453_no_op: update on a published Version gave no error, not 42501",
        "rp453_no_op: delete on a published Version gave no error, not 42501",
      ]);
    } finally {
      await migrator.query("rollback to savepoint no_op_guard");
    }
  });

  it("still lets a Version's Change Note be written once, at publish", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const version = await one(
      "insert into workflow_version (workflow_definition_id, version_no, status) values ($1, 1, 'draft') returning id",
      [definition],
    );
    await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [version]);
    await migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'once')", [version]);
    expect(await attempt("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'twice')", [version])).toBe("23505");
  });

  it("lets a Change Note of a Version that isn't published change (the guard is on published Versions only)", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const version = await one(
      "insert into workflow_version (workflow_definition_id, version_no, status) values ($1, 1, 'draft') returning id",
      [definition],
    );
    await migrator.query("insert into workflow_change_note (workflow_version_id, change_note) values ($1, 'draft note')", [version]);
    expect(await attempt("update workflow_change_note set change_note = 'changed' where workflow_version_id = $1", [version])).toBeNull();
    expect(await attempt("delete from workflow_change_note where workflow_version_id = $1", [version])).toBeNull();
  });
});
