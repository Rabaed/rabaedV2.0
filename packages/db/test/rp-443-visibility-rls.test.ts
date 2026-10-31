// Seam 2 for Rabaed Defaults changed by a Rabaed Engineer (RP-443, WF-20; visibility.md V9,
// V20, scenario RP-443-1): the app role changes no Rabaed Default, through the tables or the
// authoring commands; a Rabaed Engineer changes it on the admin connection (the rabaed_admin
// role), each change logged in admin_action in its own transaction, as Rabaed Admin's
// asEngineer does, and admin_action is append-only with a reason it can't leave out. A Tower
// Project Admin and a Tower Member read the Rabaed Default's published Versions and their
// Project's own copy, never the Default's draft; nobody signed in reads none of it.
// Seam 1: apps/admin/test/workflows.test.ts, apps/api/test/workflow-settings.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, readLatestPublishedDefinition, writeRabaedDefaultWorkflow, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RD${letters(3)}`;
/** The Rabaed Engineer, on the admin connection. */
const ENGINEER = "a Rabaed Engineer";
/** The app role with no Member: nobody signed in. */
const NOBODY = "nobody signed in";

let migrator: pg.Client;
let migratorDb: Db;
let adminDb: Db;
let app: Db;
const towerOptions = { projectCode: "RDP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let rabaedDefault = "";
let towerCopy = "";
let engineerId = "";

const name: Record<string, string> = { [ENGINEER]: ENGINEER, [NOBODY]: NOBODY };
const named = (member: string) => name[member] ?? member;
/** The rows `as` reads of `query`: on the admin connection for the Engineer, the app role with no Member for nobody, else as the Member. */
const readAs = async (as: string, query: ReturnType<typeof sql<{ id: string }>>) => {
  if (as === ENGINEER) return (await query.execute(adminDb)).rows;
  if (as === NOBODY) return (await query.execute(app)).rows;
  return tower.call<{ id: string }>(as, query);
};
const versionsOf = (id: string, status: "published" | "draft") => (as: string) =>
  readAs(as, sql<{ id: string }>`select id from workflow_version where workflow_definition_id = ${id}::uuid and status = ${status}`);
const versionId = async (id: string, no: number) => (await migrator.query("select id from workflow_version where workflow_definition_id = $1 and version_no = $2", [id, no])).rows[0].id as string;
const logged = async () =>
  (await migrator.query<{ engineer_id: string; action: string; reason: string }>("select engineer_id, action, reason from admin_action where target_id = $1 order by at, id", [rabaedDefault])).rows;

/** The Engineer's change, as asEngineer makes it: the write and its admin_action row in one transaction. */
async function asEngineer(action: "save_workflow_draft" | "publish_workflow", reason: string) {
  const current = (await readLatestPublishedDefinition(migratorDb, rabaedDefault))!;
  const next = { ...current.definition, steps: current.definition.steps.map((s) => (s.key === "draft" ? { ...s, name: bilingual(`Prepare ${digits(4)}`) } : s)) };
  await adminDb.transaction().execute(async (trx) => {
    const written = await writeRabaedDefaultWorkflow(trx, TYPE, next, { publish: action === "publish_workflow" });
    expect(written).toMatchObject({ ok: true });
    await sql`insert into admin_action (engineer_id, action, target_kind, target_id, reason) values (${engineerId}::uuid, ${action}, 'workflow_definition', ${rabaedDefault}::uuid, ${reason})`.execute(trx);
  });
}

/** A Draft of the Type raised by C1's engineer on Tower; the Version it is pinned to. */
async function raise(): Promise<number> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const { rows } = await migrator.query("select v.version_no from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = $1", [created!.work_item_id]);
  return rows[0].version_no as number;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  migratorDb = createDb(urls.migrator, { max: 1 });
  adminDb = createDb(urls.admin, { max: 1 });
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  rabaedDefault = await addTestWorkflow(run, { name: bilingual(`RP-443 default ${digits(6)}`), engineerStep: true });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Defaults (RP-443)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  const typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Defaults (RP-443)")), rabaedDefault, formId],
    )
  ).rows[0].id as string;
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [typeId, rabaedDefault]);
  engineerId = (await migrator.query("insert into rabaed_engineer (email, full_name) values ($1, 'RP-443') returning id", [`eng-${randomUUID().slice(0, 8)}@rabaed.test`])).rows[0]
    .id as string;

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, other } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "a Tower Member (C1 engineer)",
    [k1.members.engineer]: "K1 engineer",
    [other.ap]: "another Project's Project Admin",
  });

  // Tower's own copy of the Rabaed Default, published.
  const [copied] = await tower.call<{ outcome: string; workflow_definition_id: string }>(
    c1.ap,
    sql`select outcome, workflow_definition_id from app.duplicate_workflow(${rabaedDefault}::uuid, ${tower.projectId}::uuid, ${JSON.stringify(bilingual(`Tower route ${digits(4)}`))}::jsonb, now())`,
  );
  expect(copied!.outcome).toBe("duplicated");
  towerCopy = copied!.workflow_definition_id;
  expect(await tower.outcome(c1.ap, sql`select outcome from app.publish_workflow(${towerCopy}::uuid, now())`)).toBe("published");
});

afterAll(async () => {
  await app?.destroy();
  await adminDb?.destroy();
  await migratorDb?.destroy();
  await migrator?.end();
});

describe("scenario RP-443-1: Rabaed Defaults, changed by a Rabaed Engineer", () => {
  it("the app role changes no Rabaed Default: not through the tables, not through the authoring commands, a Project Admin included", async () => {
    const before = (await migrator.query("select id, status, version_no from workflow_version where workflow_definition_id = $1 order by version_no", [rabaedDefault])).rows;
    const writes = [
      sql<object>`insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "x", "ar": "x"}')`,
      sql<object>`update workflow_definition set name = '{"en": "x", "ar": "x"}' where id = ${rabaedDefault}::uuid`,
      sql<object>`update workflow_version set status = 'draft' where workflow_definition_id = ${rabaedDefault}::uuid`,
      sql<object>`delete from workflow_step where workflow_version_id in (select id from workflow_version where workflow_definition_id = ${rabaedDefault}::uuid)`,
      sql<object>`insert into admin_action (engineer_id, action, target_kind, target_id, reason) values (${engineerId}::uuid, 'publish_workflow', 'workflow_definition', ${rabaedDefault}::uuid, 'x')`,
      sql<object>`select id from admin_action`,
    ];
    for (const as of [tower.c1.ap, tower.c1.members.engineer]) {
      for (const write of writes) await expect(tower.call(as, write), `${named(as)}: ${write.compile(app).sql}`).rejects.toMatchObject({ code: "42501" });
      expect((await tower.call<{ can: boolean }>(as, sql`select app.can_author_workflow(${rabaedDefault}::uuid) as can`))[0]!.can).toBe(false);
      expect(await tower.outcome(as, sql`select outcome from app.publish_workflow(${rabaedDefault}::uuid, now())`), named(as)).toBe("not_found");
      expect(
        await tower.outcome(as, sql`select outcome from app.save_workflow_draft(${rabaedDefault}::uuid, null, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, now())`),
        named(as),
      ).toBe("not_found");
    }
    expect((await migrator.query("select id, status, version_no from workflow_version where workflow_definition_id = $1 order by version_no", [rabaedDefault])).rows).toEqual(before);
  });

  it("the Engineer's draft is logged in admin_action with the Engineer and the reason; no Member reads the draft, nor does nobody", async () => {
    await asEngineer("save_workflow_draft", "Rename the Draft Step");
    expect(await logged()).toEqual([{ engineer_id: engineerId, action: "save_workflow_draft", reason: "Rename the Draft Step" }]);
    const draft = await versionId(rabaedDefault, 2);
    const drafted = async (as: string) =>
      as === ENGINEER || as === NOBODY
        ? versionsOf(rabaedDefault, "draft")(as)
        : [...(await versionsOf(rabaedDefault, "draft")(as)), ...(await tower.call<{ id: string }>(as, sql`select workflow_version_id as id from app.workflow_draft(${rabaedDefault}::uuid)`))];
    await expectHiddenFrom({ read: drafted, target: draft, seenBy: ENGINEER, hiddenFrom: [tower.c1.ap, tower.c1.members.engineer, NOBODY], name: named, label: "the Rabaed Default's draft" });
  });

  it("a change without a reason is refused with its log, and changes nothing", async () => {
    await expect(asEngineer("publish_workflow", "  ")).rejects.toMatchObject({ code: "23514" });
    expect((await logged()).map((r) => r.action)).toEqual(["save_workflow_draft"]);
    expect((await migrator.query("select status from workflow_version where workflow_definition_id = $1 and version_no = 2", [rabaedDefault])).rows).toEqual([{ status: "draft" }]);
  });

  it("its publish is logged too, and admin_action can't be changed afterwards, even on the admin connection; Tower's new items run the new Version, an older item keeps its own", async () => {
    const older = await raise();
    await asEngineer("publish_workflow", "Publish the renamed Step");
    expect((await logged()).map((r) => r.action)).toEqual(["save_workflow_draft", "publish_workflow"]);
    await expect(sql`update admin_action set reason = 'changed' where target_id = ${rabaedDefault}::uuid`.execute(adminDb)).rejects.toThrow(/permission denied/);
    await expect(sql`delete from admin_action where target_id = ${rabaedDefault}::uuid`.execute(adminDb)).rejects.toThrow(/permission denied/);
    expect(await raise()).toBe(older + 1);
  });

  it("a Tower Project Admin and a Tower Member read the Rabaed Default's published Versions and their Project's own copy; nobody signed in, and another Project, don't read the copy", async () => {
    const { c1, k1, other } = tower;
    const towerMembers = [c1.ap, c1.members.engineer, k1.members.engineer];
    for (const no of [1, 2]) {
      await expectHiddenFrom({
        read: versionsOf(rabaedDefault, "published"),
        target: await versionId(rabaedDefault, no),
        seenBy: [...towerMembers, other.ap],
        hiddenFrom: NOBODY,
        name: named,
        label: `the Rabaed Default's Version ${no}`,
      });
    }
    await expectHiddenFrom({
      read: versionsOf(towerCopy, "published"),
      target: await versionId(towerCopy, 1),
      seenBy: towerMembers,
      hiddenFrom: [other.ap, NOBODY],
      name: named,
      label: "Tower's own copy",
    });
    const copy = (as: string) => readAs(as, sql<{ id: string }>`select id from workflow_definition where id = ${towerCopy}::uuid`);
    await expectHiddenFrom({ read: copy, target: towerCopy, seenBy: towerMembers, hiddenFrom: [other.ap, NOBODY], name: named, label: "Tower's own copy's definition" });
  });
});
