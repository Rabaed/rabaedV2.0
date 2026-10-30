// Seam 2 for visibility on a Workflow the Project made itself, not a Rabaed Default (RP-1095,
// scenario RP-1095-1; visibility.md V1, V3, V5). Every other seam-2 scenario ran on the seeded
// Defaults, and RP-1079's leak was in a read that only a custom Workflow reached. Each "hidden"
// is proved with expectHiddenFrom: a reader who may see the row reads it first, by id.
// Seam 1: apps/api/test/custom-workflow-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RC${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RCW", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let projectWorkflow = "";
let item = "";

/** The ids of the item rows `as` reads. */
const items = (as: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`);
/** Item `item`'s history as `as` reads it; its seq is the reader's own count, so an event is known by its time. */
const history = (as: string) =>
  tower.call<{ created_at: Date; type: string; audience: string }>(as, sql`select created_at, type, audience from app.work_item_history(${item}::uuid)`);
/** The time of the item's last event, as the migrator reads it: its id in `history`. */
const lastSeq = async () =>
  ((await migrator.query<{ at: Date }>("select created_at as at from work_item_event where work_item_id = $1 order by seq desc limit 1", [item])).rows[0]!.at).toISOString();

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  // The Type's Rabaed Default, which the item must not run on.
  const defaultWorkflow = await addTestWorkflow(run, { name: bilingual(`RP-1095 default ${digits(6)}`) });
  const formId = (
    await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Custom Workflow (RP-1095)"))])
  ).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  const typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Custom Workflow (RP-1095)")), defaultWorkflow, formId],
    )
  ).rows[0].id as string;

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2 } = tower;
  Object.assign(name, {
    [c1.members.project_manager]: "C1 PM",
    [c1.members.engineer]: "C1 engineer",
    [k1.members.engineer]: "K1 engineer",
    [k1.members.manager]: "K1 manager",
    [c2.members.engineer]: "C2 engineer",
  });

  // The Project's own Workflow, with a Contractor Engineer Step the Default lacks, bound to the Type.
  projectWorkflow = await addTestWorkflow(run, {
    name: bilingual(`RP-1095 Tower's own ${digits(6)}`),
    owner: { kind: "project", projectId: tower.projectId },
    engineerStep: true,
  });
  // Made for the Type, as authoring one on the Project makes it.
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [typeId, projectWorkflow]);
  await migrator.query("insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id) values ($1, $2, null, $3)", [
    tower.projectId,
    typeId,
    projectWorkflow,
  ]);

  // In Building B, which C2 covers too: only V3 keeps C1's item from C2.
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "CT-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingB}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1095-1: a Project's own Workflow", () => {
  it("runs the item: it is pinned to the Project's Workflow, not the Type's Default", async () => {
    const { rows } = await migrator.query(
      "select v.workflow_definition_id as definition from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = $1",
      [item],
    );
    expect(rows[0].definition).toBe(projectWorkflow);
  });

  it("keeps the item in C1's review from K1 (V1), then from C2 once Submitted (V3)", async () => {
    const { c1, k1, c2 } = tower;
    await expectHiddenFrom({ read: items, target: item, seenBy: c1.members.engineer, hiddenFrom: [k1.members.engineer, c2.members.engineer], name: named, label: "in C1's review" });

    expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
    expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
    const submit = await lastSeq();
    await expectHiddenFrom({ read: items, target: item, seenBy: [c1.members.project_manager, k1.members.engineer], hiddenFrom: c2.members.engineer, name: named, label: "Submitted" });
    // C1's Submit is a shared move: K1 reads it in the history, by its time.
    await expectHiddenFrom({
      read: history,
      target: submit,
      seenBy: [c1.members.project_manager, k1.members.engineer],
      hiddenFrom: c2.members.engineer,
      idOf: (row) => row.created_at.toISOString(),
      name: named,
      label: "C1's Submit",
    });
  });

  it("keeps K1's send to its Manager inside K1 (V5)", async () => {
    const { c1, k1 } = tower;
    expect(await tower.pickUp(k1.members.engineer, item)).toBe("picked_up");
    expect(await tower.take(k1.members.engineer, item, "send_to_manager")).toBe("applied");
    const sent = await lastSeq();
    await expectHiddenFrom({
      read: history,
      target: sent,
      seenBy: [k1.members.manager, k1.members.engineer],
      hiddenFrom: [c1.members.project_manager, c1.members.engineer],
      idOf: (row) => row.created_at.toISOString(),
      name: named,
      label: "K1's send to its Manager",
    });
    const asK1 = (await history(k1.members.manager)).find((row) => row.created_at.toISOString() === sent)!;
    expect(asK1).toMatchObject({ type: "transition", audience: "internal" });
  });
});
