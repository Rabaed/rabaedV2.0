// Seam 2 for Company defaults (RP-517; spec RP-511 decision 8; visibility.md V18, scenario
// RP-517-1), as the app role and the migrator:
// - the app role writes company_default only through the commands, which answer anyone but
//   the Company's Authorized Person `not_found`;
// - a Company's defaults are read by its own Members and by nobody else, and so is a Form in
//   its Library (form_definition's policy no longer lets a null project_id mean "Rabaed");
// - a default names an item of the Company's own Library only;
// - creating a Project copies the creator's Company's defaults and nobody else's.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const name = (en: string) => JSON.stringify({ en, ar: en });

let migrator: pg.Client;
let app: Db;

type Company = { id: string; ap: string; member: string };
let tmc: Company;
let rival: Company;
let typeId = "";
let tmcWorkflow = "";
let rivalWorkflow = "";
let tmcForm = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}
async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
    companyId,
    email(who),
    name(who),
    creator,
  ]);
}
async function company(engineer: string, legal: string): Promise<Company> {
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    name(legal),
    digits(10),
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, ap, member: await member(id, "member") };
}
const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const setDefault = (as: string, kind: string, item: string) =>
  outcome(as, sql`select app.set_company_default(${typeId}::uuid, ${kind}, ${item}::uuid, now()) as outcome`);
const seen = async (as: string) => (await call<{ company_id: string }>(as, sql`select company_id from company_default`)).map((r) => r.company_id);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  tmc = await company(engineer, "TMC");
  rival = await company(engineer, "Rival");
  const run = (text: string) => migrator.query(text);
  tmcWorkflow = await addTestWorkflow(run, { name: { en: "TMC route", ar: "TMC" }, owner: { kind: "company", companyId: tmc.id } });
  rivalWorkflow = await addTestWorkflow(run, { name: { en: "Rival route", ar: "Rival" }, owner: { kind: "company", companyId: rival.id } });
  typeId = await one("select id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'", []);
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2)", [typeId, [tmcWorkflow, rivalWorkflow]]);
  tmcForm = await one("insert into form_definition (owner_kind, company_id, name, work_item_type_id) values ('company', $1, $2, $3) returning id", [
    tmc.id,
    name("TMC form"),
    typeId,
  ]);
  await migrator.query(
    `insert into form_version (form_definition_id, version_no, status, schema, published_at)
     values ($1, 1, 'published', '{"sections": []}'::jsonb, now())`,
    [tmcForm],
  );
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Company defaults through the app role", () => {
  it("are written only through the commands, by the Authorized Person", async () => {
    await expect(
      call(tmc.ap, sql<object>`insert into company_default (company_id, work_item_type_id, kind, workflow_definition_id) values (${tmc.id}::uuid, ${typeId}::uuid, 'workflow', ${tmcWorkflow}::uuid)`),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await setDefault(tmc.member, "workflow", tmcWorkflow)).toBe("not_found");
    expect(await setDefault(tmc.ap, "workflow", tmcWorkflow)).toBe("set");
    expect(await setDefault(tmc.ap, "form", tmcForm)).toBe("set");
    expect(await setDefault(tmc.ap, "banana", tmcWorkflow)).toBe("not_found");
  });

  it("name the Company's own Library items only, as 'not_found' for another's or a made-up one", async () => {
    expect(await setDefault(tmc.ap, "workflow", rivalWorkflow)).toBe("not_found");
    expect(await setDefault(rival.ap, "form", tmcForm)).toBe("not_found");
    expect(await setDefault(tmc.ap, "workflow", randomUUID())).toBe("not_found");
    // A Rabaed Default is not a Library item.
    expect(await setDefault(tmc.ap, "workflow", await one("select workflow_definition_id as id from work_item_type where id = $1", [typeId]))).toBe("not_found");
  });

  it("are read by the Company's Members and nobody else (V18)", async () => {
    expect(await seen(tmc.member)).toEqual([tmc.id, tmc.id]);
    expect(await seen(tmc.ap)).toEqual([tmc.id, tmc.id]);
    expect(await seen(rival.ap)).toEqual([]);
    expect(await seen(rival.member)).toEqual([]);
    await setDefault(rival.ap, "workflow", rivalWorkflow);
    expect(await seen(rival.ap)).toEqual([rival.id]);
    expect(await seen(tmc.ap)).toEqual([tmc.id, tmc.id]);
  });

  it("keep a Library Form to its own Company, and Rabaed Defaults to all (V18)", async () => {
    const forms = (as: string) => call<{ id: string }>(as, sql`select id from form_definition where id = ${tmcForm}::uuid`).then((r) => r.length);
    expect(await forms(tmc.member)).toBe(1);
    expect(await forms(rival.member)).toBe(0);
    const versions = (as: string) => call<{ id: string }>(as, sql`select id from form_version where form_definition_id = ${tmcForm}::uuid`).then((r) => r.length);
    expect(await versions(tmc.member)).toBe(1);
    expect(await versions(rival.member)).toBe(0);
    const rabaed = await call<{ id: string }>(rival.member, sql`select id from form_definition where owner_kind = 'rabaed'`);
    expect(rabaed.length).toBeGreaterThan(0);
  });

  it("are cleared by the Authorized Person only, and Projects already created keep their copies", async () => {
    const [created] = await call<{ project_id: string }>(tmc.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'CDR', 'contractor')`);
    const copies = () =>
      call<{ n: number }>(tmc.ap, sql`select count(*)::int as n from workflow_binding where project_id = ${created!.project_id}::uuid`).then((r) => r[0]!.n);
    expect(await copies()).toBe(1);
    expect(await outcome(tmc.member, sql`select app.clear_company_default(${typeId}::uuid, 'workflow', now()) as outcome`)).toBe("not_found");
    expect(await outcome(rival.ap, sql`select app.clear_company_default(${typeId}::uuid, 'form', now()) as outcome`)).toBe("cleared");
    expect(await seen(tmc.ap)).toEqual([tmc.id, tmc.id]);
    expect(await outcome(tmc.ap, sql`select app.clear_company_default(${typeId}::uuid, 'workflow', now()) as outcome`)).toBe("cleared");
    expect(await seen(tmc.ap)).toEqual([tmc.id]);
    expect(await copies()).toBe(1);
    // Rival's own Project copies Rival's default, never TMC's.
    const [rivals] = await call<{ project_id: string }>(rival.ap, sql`select project_id from app.create_project('{"en": "Rival", "ar": "منافس"}'::jsonb, 'CDV', 'contractor')`);
    const names = await call<{ name: { en: string } }>(rival.ap, sql`select d.name from workflow_definition d where d.project_id = ${rivals!.project_id}::uuid`);
    expect(names.map((n) => n.name.en)).toEqual(["Rival route"]);
  });

  it("write one setup_event row per command that changed something, to the Company or the Project (RP-450)", async () => {
    const rows = async (where: string, id: string) =>
      (await migrator.query(`select type from setup_event where kind = 'company_default' and ${where} = $1 order by created_at, id`, [id])).rows.map((r) => r.type);
    // TMC: set workflow, set form, cleared workflow; the refused commands wrote nothing.
    expect(await rows("company_id", tmc.id)).toEqual(["default_set", "default_set", "default_cleared"]);
    const applied = await migrator.query("select type, company_id from setup_event where kind = 'company_default' and type = 'defaults_applied' and project_id is not null");
    expect(applied.rows.length).toBeGreaterThanOrEqual(2);
    expect(applied.rows.every((r) => r.company_id === null)).toBe(true);
    await expect(call(tmc.ap, sql`select * from setup_event`)).rejects.toMatchObject({ code: "42501" });
  });
});
