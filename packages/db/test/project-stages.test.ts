// Seam 2 for a Project's Stages (RP-428, WF-5; data-model.md stage, project_event).
// A Project gets its own copy of the Rabaed Default Stages when it is created, and
// of a Rabaed Default Stage added later; every Member of the Project reads them
// and nobody else (project-rls.test.ts checks the table among every Project
// table); each change by its Project Admin is audited in project_event, which is
// append-only and out of the app role's reach.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { moduleKeys } from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const stageKeyCases = JSON.parse(readFileSync(new URL("../../domain/src/stage-key-cases.json", import.meta.url), "utf8")) as {
  key: string;
  valid: boolean;
}[];

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let creator = "";
let colleague = "";
let projectId = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: "S", ar: "س" }), digits(10), `3${digits(13)}3`, engineer],
  );
  const member = (who: string, canCreate: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      canCreate,
    ]);
  creator = await member("creator", true);
  colleague = await member("colleague", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [creator, companyId]);
  projectId = await withMember(app, creator, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, 'STG', 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const stagesOf = async (project: string, module = "submittals") =>
  (
    await migrator.query<{ key: string; category: string }>(
      "select key, category from stage where project_id = $1 and module_key = $2 order by sort, key",
      [project, module],
    )
  ).rows;

const outcomeAs = (memberId: string, query: ReturnType<typeof sql<{ outcome: string }>>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows[0]!.outcome);

describe("a new Project's Stages", () => {
  it("are its own copies of the Rabaed Defaults, key, category and order", async () => {
    const defaults = (
      await migrator.query("select key, category from stage where owner_kind = 'rabaed' and module_key = 'submittals' order by sort, key")
    ).rows;
    expect(defaults.length).toBeGreaterThan(0);
    expect(await stagesOf(projectId)).toEqual(defaults);
  });

  it("gain a Rabaed Default Stage added later, kept where the Project has the key", async () => {
    await migrator.query("begin");
    try {
      await migrator.query(
        `insert into stage (owner_kind, module_key, key, name, category, sort)
         values ('rabaed', 'inspections', 'probe_stage', '{"en": "Probe", "ar": "تجربة"}', 'in_progress', 1)`,
      );
      // Other tests may have added Rabaed Default Stages to the Module (workflow-ownership-rls's): each is copied too.
      expect(await stagesOf(projectId, "inspections")).toContainEqual({ key: "probe_stage", category: "in_progress" });
    } finally {
      await migrator.query("rollback");
    }
  });
});

describe("the Project Admin's Stage commands", () => {
  it("are audited in project_event, which the app role can't read and nobody can change", async () => {
    expect(
      await outcomeAs(creator, sql`select app.rename_stage(${projectId}::uuid, 'submittals', 'approved', '{"en": "Done", "ar": "تم"}'::jsonb) as outcome`),
    ).toBe("renamed");
    const { rows } = await migrator.query("select type, actor_member_id, payload from project_event where project_id = $1", [projectId]);
    expect(rows).toEqual([
      {
        type: "stage_renamed",
        actor_member_id: creator,
        payload: { module: "submittals", key: "approved", from: { en: "Approved", ar: "معتمد" }, to: { en: "Done", ar: "تم" } },
      },
    ]);
    await expect(withMember(app, creator, (trx) => sql`select * from project_event`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(migrator.query("update project_event set payload = '{}' where project_id = $1", [projectId])).rejects.toThrow(/append-only/);
    await expect(migrator.query("delete from project_event where project_id = $1", [projectId])).rejects.toThrow(/append-only/);
  });

  it("answer not_found to a Member who isn't the Project's Admin, and change nothing", async () => {
    const before = await stagesOf(projectId);
    expect(await outcomeAs(colleague, sql`select app.delete_stage(${projectId}::uuid, 'submittals', 'approved') as outcome`)).toBe("not_found");
    expect(
      await outcomeAs(colleague, sql`select app.add_stage(${projectId}::uuid, 'submittals', 'x', '{"en": "X", "ar": "س"}'::jsonb, 'draft') as outcome`),
    ).toBe("not_found");
    expect(await stagesOf(projectId)).toEqual(before);
  });

  it("keep a Stage that a Workflow the Project once bound uses, after the binding is taken away", async () => {
    // A Rabaed Workflow for the MAR whose one Step is in a Stage only it uses.
    const { rows } = await migrator.query<{ definition_id: string; type_id: string }>(`
      with type as (select id from work_item_type where code = 'MAR' and project_id is null),
      definition as (
        insert into workflow_definition (owner_kind, name, work_item_type_id)
        select 'rabaed', '{"en": "Held route (test)", "ar": "مسار معلق"}', id from type returning id
      ), version as (
        insert into workflow_version (workflow_definition_id, version_no, status) select id, 1, 'draft' from definition returning id
      ), step as (
        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode)
        select id, 'held', '{"en": "Held", "ar": "معلق"}', 'probe_held', '{"base_role": "contractor", "permission": "create"}', 'none'
        from version returning id
      )
      select definition.id as definition_id, (select id from type) as type_id from definition, step`);
    const { definition_id: definitionId, type_id: typeId } = rows[0]!;
    await migrator.query("update workflow_version set status = 'published', published_at = now() where workflow_definition_id = $1", [definitionId]);
    expect(
      await outcomeAs(
        creator,
        sql`select app.add_stage(${projectId}::uuid, 'submittals', 'probe_held', '{"en": "Held", "ar": "معلق"}'::jsonb, 'in_progress') as outcome`,
      ),
    ).toBe("added");
    const inUse = () =>
      withMember(app, creator, (trx) => sql<{ in_use: boolean }>`select app.stage_in_use(${projectId}::uuid, 'submittals', 'probe_held') as in_use`.execute(trx)).then(
        (r) => r.rows[0]!.in_use,
      );
    expect(await inUse()).toBe(false);

    expect(await outcomeAs(creator, sql`select app.bind_workflow(${projectId}::uuid, ${typeId}::uuid, null, ${definitionId}::uuid, now()) as outcome`)).toBe(
      "bound",
    );
    expect(await inUse()).toBe(true);
    // Items raised meanwhile may still run it: the Stage stays.
    expect(await outcomeAs(creator, sql`select app.unbind_workflow(${projectId}::uuid, ${typeId}::uuid, null, now()) as outcome`)).toBe("unbound");
    expect(await inUse()).toBe(true);
    expect(await outcomeAs(creator, sql`select app.delete_stage(${projectId}::uuid, 'submittals', 'probe_held') as outcome`)).toBe("stage_in_use");
  });

  it("can't be written around: the app role writes no Stage directly", async () => {
    await expect(withMember(app, creator, (trx) => sql`update stage set sort = 0`.execute(trx))).rejects.toThrow(/permission denied/);
  });
});

// The same rules as @rabaed/domain's stageKey and moduleKeys, over the same cases.
describe("app.is_stage_key, the cases shared with @rabaed/domain", () => {
  it.each(stageKeyCases)("$key: $valid", async ({ key, valid }) => {
    const { rows } = await migrator.query<{ valid: boolean }>("select app.is_stage_key($1) as valid", [key]);
    expect(rows[0]!.valid).toBe(valid);
  });
});

describe("app.module_keys", () => {
  it("are @rabaed/domain's Modules, the one list the Stage commands and the tables' checks read", async () => {
    const { rows } = await migrator.query<{ keys: string[] }>("select app.module_keys() as keys");
    expect([...rows[0]!.keys].sort()).toEqual([...moduleKeys].sort());
  });
});

// Owner decision 2026-10-10 (RP-409): the Draft Stage reads "Draft", one item's Status.
describe("the Draft Stage's name", () => {
  it("is Draft in every Module's Rabaed Defaults and in a new Project's copy", async () => {
    const { rows } = await migrator.query<{ name: unknown }>(
      "select distinct name from stage where key = 'draft' and (owner_kind = 'rabaed' or project_id = $1)",
      [projectId],
    );
    expect(rows).toEqual([{ name: { en: "Draft", ar: "مسودة" } }]);
  });
});
