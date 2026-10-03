// Seam 2 for the Form's `member` and `participant` fields (RP-266): the two
// functions behind them answer as their caller may see (V14, V15). Project B's
// Member gets nothing of Project A's answers or Participants, not even by
// naming Project A's item from their own Project.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "MARDB";

let migrator: pg.Client;
let app: Db;

type Side = { name: { en: string; ar: string }; ap: string; projectId: string; participantId: string; itemId: string };
let a: Side;
let b: Side;

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A test-only Rabaed Default Type (the MAR's Workflow) whose Form has a `member` and a `participant` field. */
async function addPeopleType() {
  const schema = {
    sections: [
      {
        key: "people",
        title: { en: "People", ar: "الأشخاص" },
        fields: [
          { key: "who", type: "member", label: { en: "Who", ar: "من" } },
          { key: "through", type: "participant", label: { en: "Through", ar: "عن طريق" } },
        ],
      },
    ],
  };
  await migrator.query(
    `do $$
      declare v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "People", "ar": "الأشخاص"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, '${TYPE}', '{"en": "People", "ar": "الأشخاص"}', workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$`,
  );
}

/** A Company whose Authorized Person creates a Project and raises an item naming themselves and their Participant. */
async function side(engineer: string, en: string): Promise<Side> {
  const name = { en, ar: en };
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify(name), digits(10), `3${digits(13)}3`, engineer],
  );
  const ap = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [companyId, email("ap"), JSON.stringify(name)],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
  const [created] = await call<{ project_id: string }>(
    ap,
    sql`select project_id from app.create_project(${JSON.stringify(name)}::jsonb, 'TWR', 'contractor')`,
  );
  const projectId = created!.project_id;
  const [electrical] = await call<{ value_id: string }>(
    ap,
    sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'EL', '{"en": "EL", "ar": "EL"}'::jsonb)`,
  );
  const participantId: string = (await migrator.query("select participant_id from project_member where project_id = $1", [projectId]))
    .rows[0].participant_id;
  for (const kind of ["trade", "location"]) {
    const set = await call<{ outcome: string }>(ap, sql`
      select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome
      union all
      select app.set_member_visibility(${participantId}::uuid, ${ap}::uuid, ${kind}, true, '{}'::uuid[], now())`);
    expect(set.map((r) => r.outcome)).toEqual(["set", "set"]);
  }
  const data = JSON.stringify({ who: ap, through: participantId });
  const [item] = await call<{ outcome: string; work_item_id: string }>(
    ap,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${data}::jsonb,
      ${electrical!.value_id}::uuid, null, now())`,
  );
  expect(item!.outcome).toBe("created");
  return { name, ap, projectId, participantId, itemId: item!.work_item_id };
}

const named = (as: string, itemId: string) =>
  call<{ field_key: string }>(as, sql`select * from app.work_item_named_answers(${itemId}::uuid) order by field_key`);

const choices = (as: string, projectId: string, itemId: string | null) =>
  call<{ participant_id: string }>(as, sql`select * from app.form_participant_choices(${projectId}::uuid, ${itemId}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addPeopleType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Test Engineer') returning id", [email("engineer")]);
  a = await side(engineer, "Company A");
  b = await side(engineer, "Company B");
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

describe("app.work_item_named_answers", () => {
  it("names the caller's own Member and Participant", async () => {
    expect(await named(a.ap, a.itemId)).toEqual([
      { field_key: "through", field_type: "participant", company_name: a.name, member_name: null },
      { field_key: "who", field_type: "member", company_name: a.name, member_name: a.name },
    ]);
  });

  it("answers nothing for an item the caller can't see", async () => {
    expect(await named(b.ap, a.itemId)).toEqual([]);
  });
});

describe("app.form_participant_choices", () => {
  it("offers the caller's own Participant on their Project", async () => {
    expect((await choices(a.ap, a.projectId, null)).map((r) => r.participant_id)).toEqual([a.participantId]);
    expect((await choices(a.ap, a.projectId, a.itemId)).map((r) => r.participant_id)).toEqual([a.participantId]);
  });

  it("offers nothing on a Project the caller isn't on, and nothing of another Project's item", async () => {
    expect(await choices(b.ap, a.projectId, null)).toEqual([]);
    expect(await choices(b.ap, a.projectId, a.itemId)).toEqual([]);
    expect((await choices(b.ap, b.projectId, a.itemId)).map((r) => r.participant_id)).toEqual([b.participantId]);
  });
});
