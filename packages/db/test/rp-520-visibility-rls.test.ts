// Seam 2 for a Project or item URL of a Project the reader isn't on (RP-520; visibility.md V3, layer 1; scenario
// RP-520-1), as the app role. Nasser is the Authorized Person of a Company with a Project of its own and none shared
// with the Tower: through the reads the api's Project, Work Item list and item pages stand on (the project and
// work_item tables' RLS, app.work_items_seen), he reads no row of the Tower's Project or its item, by id, beside C1's
// engineer, who does; and what he reads for them is what he reads for a made-up id, so nothing says either exists.
// He reads his own Project, so the read works for him. Seam 1: apps/api/test/demo-seed.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RN${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RNF", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let nasser = "";
let item = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

/** Project `id` as `as` reads it: the Project page's read, one row when they are on it. */
const project = (as: string, id: string) => tower.call<{ id: string }>(as, sql`select id from project where id = ${id}::uuid`);
/** Project `id`'s Work Item list as `as` reads it (app.work_items_seen, as the api's List reads it). */
const workItems = (as: string, id: string) =>
  tower.call<{ id: string }>(as, sql`select w.id from app.work_items_seen(${id}::uuid, array['submittals']::text[], false, null) w`);
/** Item `id` as `as` reads it: the item page's read, one row when they may see it. */
const workItem = (as: string, id: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-520 not found ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Not found (RP-520)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Not found (RP-520)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  nasser = tower.other.ap;
  names.set(tower.c1.members.engineer, "C1 engineer");
  names.set(nasser, "Nasser (on another Project only)");

  // C1's item on the Tower, Submitted.
  const { c1 } = tower;
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${"Cable trays"}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "Cable trays" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-520-1: Nasser, not on the Tower, opens its Project, Work Item list and item, at seam 2", () => {
  it("reads his own Project: the positive control", async () => {
    expect(await project(nasser, tower.other.projectId)).toEqual([{ id: tower.other.projectId }]);
  });

  it("reads no row of the Tower's Project, its Work Item list or its item, beside C1's engineer who does", async () => {
    const seenBy = tower.c1.members.engineer;
    await expectHiddenFrom({ read: (as: string) => project(as, tower.projectId), target: tower.projectId, seenBy, hiddenFrom: nasser, name: named, label: "the Project" });
    await expectHiddenFrom({ read: (as: string) => workItems(as, tower.projectId), target: item, seenBy, hiddenFrom: nasser, name: named, label: "its Work Item list" });
    await expectHiddenFrom({ read: (as: string) => workItem(as, item), target: item, seenBy, hiddenFrom: nasser, name: named, label: "the item" });
  });

  it("reads for them exactly what he reads for a made-up id: nothing says either exists", async () => {
    const madeUp = randomUUID();
    expect(await project(nasser, tower.projectId)).toEqual(await project(nasser, madeUp));
    expect(await workItems(nasser, tower.projectId)).toEqual(await workItems(nasser, madeUp));
    expect(await workItem(nasser, item)).toEqual(await workItem(nasser, madeUp));
  });
});
