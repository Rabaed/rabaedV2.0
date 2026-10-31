// Seam 2 for the publish dialog's and the Versions history's counts (RP-555; spec RP-528;
// visibility.md V1, V5, V15, V20, scenario RP-555-1), through the count both make
// (apps/api/src/projects/workflows.ts, runningByVersion: open items per published Version, as
// row-level security on work_item lets the reader see them, app.sees_work_item) and the Change
// Note's own row-level security. Tower's Project Admin publishes Tower's own Workflow with a
// Change Note and binds it; C1's and C2's engineers each raise a Draft on it. The Project Admin
// counts neither Draft, each engineer only their own; the Change Note is the authors' alone.
// Seam 1: apps/api/test/workflow-change-note.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RN${letters(3)}`;
const CHANGE_NOTE = "Adds the Contractor Engineer Step";

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RNP" } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let route = "";
let versionOne = "";
let c1Draft = "";
let c2Own = "";

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;

/** Open items per published Version of the route, as `as` counts them (runningByVersion's query). */
const running = async (as: string) =>
  (
    await tower.call<{ version_no: number; count: string }>(
      as,
      sql`select v.version_no, count(*) as count
        from work_item w join workflow_version v on v.id = w.workflow_version_id
        where v.workflow_definition_id = ${route}::uuid and w.closed_at is null
        group by v.version_no order by v.version_no`,
    )
  ).map((r) => ({ versionNo: r.version_no, count: Number(r.count) }));
/** The items running on the route that `as` reads, by id: what the count counts. */
const counted = (as: string) =>
  tower.call<{ id: string }>(
    as,
    sql`select w.id from work_item w join workflow_version v on v.id = w.workflow_version_id where v.workflow_definition_id = ${route}::uuid and w.closed_at is null`,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  const rabaedDefault = await addTestWorkflow(run, { name: bilingual(`RP-555 default ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Counts (RP-555)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  const typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Counts (RP-555)")), rabaedDefault, formId],
    )
  ).rows[0].id as string;
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [typeId, rabaedDefault]);

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2 } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "C1 engineer",
    [c1.members.project_manager]: "C1 PM",
    [k1.members.engineer]: "K1 engineer",
    [c2.members.engineer]: "C2 engineer",
  });

  // Tower's own Workflow, published from the builder with a Change Note, and bound for the Type.
  const [copied] = await tower.call<{ outcome: string; workflow_definition_id: string }>(
    c1.ap,
    sql`select outcome, workflow_definition_id from app.duplicate_workflow(${rabaedDefault}::uuid, ${tower.projectId}::uuid, ${JSON.stringify(bilingual(`Tower route ${digits(4)}`))}::jsonb, now())`,
  );
  expect(copied!.outcome).toBe("duplicated");
  route = copied!.workflow_definition_id;
  const [published] = await tower.call<{ outcome: string; workflow_version_id: string }>(
    c1.ap,
    sql`select outcome, workflow_version_id from app.publish_workflow_with_change_note(${route}::uuid, now(), ${CHANGE_NOTE})`,
  );
  expect(published!.outcome).toBe("published");
  versionOne = published!.workflow_version_id;
  expect(await tower.outcome(c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${route}::uuid, now()) as outcome`)).toBe("bound");

  // A Draft each: C1's engineer's in Building A, C2's engineer's in Building B, which C2 covers.
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'C1 cable trays', app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  c1Draft = created!.work_item_id;
  c2Own = await c2Draft(tower, { type: TYPE, title: "C2 cable trays" });
  // Both run on the route's Version 1.
  expect((await migrator.query("select workflow_version_id from work_item where id = any($1::uuid[])", [[c1Draft, c2Own]])).rows).toEqual([
    { workflow_version_id: versionOne },
    { workflow_version_id: versionOne },
  ]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-555-1: the counts of items that keep their Version", () => {
  it("count only the items the reader sees: the Project Admin neither Draft, each engineer their own", async () => {
    const { c1, c2 } = tower;
    // Each Draft by its id: read by its raiser, by neither the Project Admin nor the other Contractor.
    await expectHiddenFrom({ read: counted, target: c1Draft, seenBy: c1.members.engineer, hiddenFrom: [c1.ap, c2.members.engineer], name: named, label: "C1's Draft" });
    await expectHiddenFrom({ read: counted, target: c2Own, seenBy: c2.members.engineer, hiddenFrom: [c1.ap, c1.members.engineer], name: named, label: "C2's Draft" });
    expect(await running(c1.ap)).toEqual([]); // not hidden-from: the scenario is the count; each Draft it leaves out is proved by id above
    expect(await running(c1.members.engineer)).toEqual([{ versionNo: 1, count: 1 }]);
    expect(await running(c2.members.engineer)).toEqual([{ versionNo: 1, count: 1 }]);
    expect((await counted(c1.members.engineer)).map((r) => r.id)).toEqual([c1Draft]);
    expect((await counted(c2.members.engineer)).map((r) => r.id)).toEqual([c2Own]);
  });

  it("the Change Note is read by the Workflow's authors only, though every Member on Tower reads the Version whole (V15, V20)", async () => {
    const { c1, k1, c2 } = tower;
    const members = [c1.members.engineer, c1.members.project_manager, k1.members.engineer, c2.members.engineer];
    const versions = async (as: string) => tower.call<{ id: string }>(as, sql`select id from workflow_version where workflow_definition_id = ${route}::uuid`);
    for (const as of [c1.ap, ...members]) expect((await versions(as)).map((r) => r.id), named(as)).toEqual([versionOne]);
    const notes = async (as: string) =>
      (await tower.call<{ workflow_version_id: string; change_note: string }>(as, sql`select workflow_version_id, change_note from workflow_change_note where workflow_version_id = ${versionOne}::uuid`)).map(
        (r) => ({ id: r.workflow_version_id, note: r.change_note }),
      );
    expect(await notes(c1.ap)).toEqual([{ id: versionOne, note: CHANGE_NOTE }]);
    await expectHiddenFrom({ read: notes, target: versionOne, seenBy: c1.ap, hiddenFrom: members, name: named, label: "the Change Note" });
  });
});
