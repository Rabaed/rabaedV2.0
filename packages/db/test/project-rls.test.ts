// Seam 2 for Projects (RP-189; ADR 0007): the Project is the tenancy boundary.
// With a Member of Project A set, an unfiltered SELECT on any Project table
// returns exactly Project A's rows; with no Member set, nothing at all.
//
// The tables are found, not listed: every table with a project_id column (and
// project itself) is checked, so each later Project table is covered as soon as
// its migration lands. Both Projects have rows in every one of them (RP-236), so
// a missing or too-wide policy shows up as a wrong set of Projects.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const ids = { creatorA: "", colleagueA: "", creatorB: "", projectA: "", projectB: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Company whose Authorized Person is a Project Creator, and a plain Member, inserted as the migrator. */
async function company(engineer: string, name: string) {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const member = (who: string, creator: boolean) =>
    one(
      "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
      [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
    );
  const creator = await member("creator", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [creator, companyId]);
  return { companyId, creator, colleague: await member("colleague", false) };
}

/** Creates a Project the way the API does: app.create_project, as the Project Creator. */
function createProject(memberId: string, code: string): Promise<string> {
  return withMember(app, memberId, (trx) =>
    sql<{ project_id: string }>`
      select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')
    `
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  const a = await company(engineer, "Company A");
  const b = await company(engineer, "Company B");
  ids.creatorA = a.creator;
  ids.colleagueA = a.colleague;
  ids.creatorB = b.creator;
  app = createDb(urls.app, { max: 2 });
  ids.projectA = await createProject(ids.creatorA, "AAA");
  ids.projectB = await createProject(ids.creatorB, "BBB");
  await fillProject(ids.projectA, ids.creatorA);
  await fillProject(ids.projectB, ids.creatorB);
});

/** Runs `query` as `memberId` and returns its first row. */
const firstRowAs = <T extends object>(memberId: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows[0]!);

/**
 * Gives the Project a row in every Project table: through the app's functions,
 * as its creator (its Authorized Person and Project Admin), where they exist;
 * as the migrator for what no function writes yet (a Project's own definitions)
 * or only the worker writes (notifications).
 */
async function fillProject(projectId: string, creator: string) {
  const participantId = await one("select id from participant where project_id = $1", [projectId]);
  const expectOutcome = async (query: ReturnType<typeof sql<{ outcome: string }>>, expected: string) =>
    expect((await firstRowAs(creator, query)).outcome).toBe(expected);
  const value = (kind: string, code: string) =>
    firstRowAs(
      creator,
      sql<{ value_id: string }>`
        select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, '{"en": "V", "ar": "ق"}'::jsonb)
      `,
    ).then((r) => r.value_id);
  const values = { trade: await value("trade", "EL"), location: await value("location", "BA") };
  const scope = await firstRowAs(
    creator,
    sql<{ outcome: string; scope_id: string }>`select outcome, scope_id from app.add_scope(${projectId}::uuid, ${values.trade}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
  );
  expect(scope.outcome).toBe("added");

  // Value lists rather than "all", so visibility_grant_value gets rows too.
  for (const [kind, id] of Object.entries(values)) {
    await expectOutcome(
      sql`select app.set_participant_visibility(${participantId}::uuid, ${kind}, false, ${[id]}::uuid[], now()) as outcome`,
      "set",
    );
    await expectOutcome(
      sql`select app.set_member_visibility(${participantId}::uuid, ${creator}::uuid, ${kind}, false, ${[id]}::uuid[], now()) as outcome`,
      "set",
    );
  }
  await expectOutcome(
    sql`select app.set_project_member_positions(${participantId}::uuid, ${creator}::uuid, ${["engineer", "project_manager"]}::text[]) as outcome`,
    "set",
  );

  const created = await firstRowAs(
    creator,
    sql<{ outcome: string; work_item_id: string }>`
      select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb, ${values.trade}::uuid, ${values.location}::uuid, now(), ${[scope.scope_id]}::uuid[])
    `,
  );
  expect(created.outcome).toBe("created");
  const item = created.work_item_id;
  // A Document, through the upload functions (the api checks the file in storage; here it's taken as stored).
  const upload = await firstRowAs(
    creator,
    sql<{ outcome: string; document_id: string }>`
      select outcome, document_id from app.start_document_upload(${item}::uuid, 'datasheet.pdf', 1024, 'application/pdf', now())
    `,
  );
  expect(upload.outcome).toBe("started");
  await expectOutcome(
    sql`select app.confirm_document_upload(${item}::uuid, ${upload.document_id}::uuid, 1024, 'application/pdf', now()) as outcome`,
    "confirmed",
  );
  // Numbers the item, keeps the idempotency key and queues a notification to the Step Pool.
  await expectOutcome(
    sql`select app.take_transition(${item}::uuid, 'send_for_review', '{}', '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    "applied",
  );

  await migrator.query(
    `insert into notification (member_id, project_id, work_item_id, outbox_id, kind, step_id)
     select $1, w.project_id, w.id, o.id, 'step_reached', w.current_step_id
     from work_item w join outbox o on o.project_id = w.project_id where w.id = $2
     limit 1`,
    [creator, item],
  );
  const name = JSON.stringify({ en: "Own", ar: "خاص" });
  await migrator.query(
    "insert into project_role (owner_kind, project_id, base_role, name, code) values ('project', $1, 'contractor', $2, 'OWNC')",
    [projectId, name],
  );
  await migrator.query(
    `insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
     values ('project', $1, 'submittals', 'own_stage', $2, 'in_progress', 9)`,
    [projectId, name],
  );
  const definition = await one("insert into workflow_definition (owner_kind, project_id, name) values ('project', $1, $2) returning id", [
    projectId,
    name,
  ]);
  const form = await one("insert into form_definition (owner_kind, project_id, name) values ('project', $1, $2) returning id", [
    projectId,
    name,
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, project_id, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('project', $1, 'submittals', 'OWN', $2, $3, 'none', $4)`,
    [projectId, name, definition, form],
  );
  // Nothing writes Numbering Patterns yet (RP-313).
  await migrator.query(
    `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, set_by_member_id)
     values ($1, '[{"kind": "project"}, {"kind": "participant"}]', '/', 5, '[0, 1]', $2)`,
    [projectId, creator],
  );
}

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** Every Project table and the column holding its Project. */
async function projectTables(): Promise<{ table: string; column: string }[]> {
  const { rows } = await migrator.query<{ table: string }>(`
    select c.table_name as table from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'project_id' and t.table_type = 'BASE TABLE'
      -- The rest are out of the app role's reach altogether (see below).
      and has_table_privilege('rabaed_app', format('%I.%I', c.table_schema, c.table_name), 'select')
    order by 1
  `);
  return [{ table: "project", column: "id" }, ...rows.map((r) => ({ table: r.table, column: "project_id" }))];
}

/** The Projects whose rows `trx` sees in `table`, unfiltered. */
async function projectsSeen(trx: Db, { table, column }: { table: string; column: string }): Promise<string[]> {
  const { rows } = await sql<{ project: string | null }>`
    select distinct ${sql.ref(column)} as project from ${sql.table(table)}
  `.execute(trx);
  return rows.map((r) => r.project).filter((p): p is string => p !== null);
}

// Written and read only through SECURITY DEFINER functions: with no read policy,
// no Member sees any of their rows. Kept by hand on purpose: a new Project table
// is expected readable by its own Project until it is added here.
// (numbering_counter is read by Project Admins only, as each creator here is;
// numbering-counter-rls.test.ts shows no other Member reads it.)
const unreadable = ["command_idempotency", "outbox"];

describe("every Project table", () => {
  it("includes the tables this ticket adds", async () => {
    const tables = (await projectTables()).map((t) => t.table);
    expect(tables).toEqual(expect.arrayContaining(["project", "participant", "project_member", "project_admin", "project_role"]));
  });

  it("has rows of both Projects, so the check below can tell them apart", async () => {
    for (const { table, column } of await projectTables()) {
      const col = pg.escapeIdentifier(column);
      const { rows } = await migrator.query<{ project: string }>(
        `select distinct ${col} as project from ${pg.escapeIdentifier(table)} where ${col} = any($1)`,
        [[ids.projectA, ids.projectB]],
      );
      expect(rows.map((r) => r.project).sort(), table).toEqual([ids.projectA, ids.projectB].sort());
    }
  });

  it("shows a Member of each Project exactly that Project's rows, or none where no Member reads", async () => {
    for (const t of await projectTables()) {
      for (const [who, project] of [
        [ids.creatorA, ids.projectA],
        [ids.creatorB, ids.projectB],
      ] as const) {
        const expected = unreadable.includes(t.table) ? [] : [project];
        expect(await withMember(app, who, (trx) => projectsSeen(trx, t)), t.table).toEqual(expected);
      }
    }
  });

  it("shows a Member of the same Company who is not on the Project nothing of it", async () => {
    for (const t of await projectTables()) {
      expect(await withMember(app, ids.colleagueA, (trx) => projectsSeen(trx, t)), t.table).toEqual([]);
    }
  });

  it("returns no rows at all with no Member set", async () => {
    for (const { table } of await projectTables()) {
      const { rows } = await app.transaction().execute((trx) => sql`select 1 from ${sql.table(table)}`.execute(trx));
      expect(rows, table).toEqual([]);
    }
  });

  it("cannot be written directly by the app role", async () => {
    for (const { table } of await projectTables()) {
      await expect(
        withMember(app, ids.creatorA, (trx) => sql`delete from ${sql.table(table)}`.execute(trx)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("company_project_counter and onboarding_lead", () => {
  it("are out of the app role's reach", async () => {
    for (const table of ["company_project_counter", "onboarding_lead"]) {
      await expect(
        withMember(app, ids.creatorA, (trx) => sql`select * from ${sql.table(table)}`.execute(trx)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("app.create_project", () => {
  it("is refused to a Member who is not a Project Creator, and with no Member set", async () => {
    await expect(createProject(ids.colleagueA, "NOPE")).rejects.toThrow(/only a Project Creator/);
    await expect(
      app.transaction().execute((trx) =>
        sql`select * from app.create_project('{"en": "P", "ar": "م"}'::jsonb, 'NOPE', 'contractor')`.execute(trx),
      ),
    ).rejects.toThrow(/only a Project Creator/);
  });

  it("gives the Project Number back when the creation fails after taking it", async () => {
    const counter = async () =>
      (
        await migrator.query(
          "select last_project_number from company_project_counter c join member m on m.company_id = c.company_id where m.id = $1",
          [ids.creatorA],
        )
      ).rows[0].last_project_number as number;
    const before = await counter();
    // A lowercase code passes the function's checks but fails project's own constraint, after the increment.
    await expect(createProject(ids.creatorA, "bad")).rejects.toThrow(/check constraint/);
    expect(await counter()).toBe(before);
    await createProject(ids.creatorA, "NEXT");
    expect(await counter()).toBe(before + 1);
  });
});
