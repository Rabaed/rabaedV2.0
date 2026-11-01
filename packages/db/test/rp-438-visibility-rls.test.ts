// Seam 2 for "View workflow", an item's Workflow map (RP-438, WF-15; visibility.md V14, V20,
// scenario RP-438-1), through the reads the map makes (apps/api/src/work-items/workflow-map.ts):
// the pinned Version's Steps through row-level security, and where the item is through
// app.step_as_seen, app.work_item_holder and app.work_item_companies. Everyone who sees the
// item reads the Version whole; inside K1 its current Step, anyone else only the Step it
// arrived at with K1, so K1's move from its engineer to its manager changes nothing they read.
// Seam 1: apps/api/test/workflow-map.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RM${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RMP", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let item = "";
let versionId = "";
const stepId: Record<string, string> = {};

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;

/** Where `as` reads the item on its map: the Step app.step_as_seen gives, whether the holder is their own Participant, and which Participant holds it. */
const whereAs = async (as: string) =>
  (
    await tower.call<{ step_id: string; holder_mine: boolean | null; holder: string | null }>(
      as,
      sql`select seen.step_id, a.participant_id in (select app.current_participant_ids()) as holder_mine, holder.participant_id as holder
        from work_item w
        cross join lateral app.step_as_seen(w.id) seen
        left join app.work_item_holder(w.id) a on true
        left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
        where w.id = ${item}::uuid`,
    )
  )[0];
/** The Steps of the item's pinned Version `as` reads, by id. */
const versionSteps = async (as: string) =>
  (await tower.call<{ id: string }>(as, sql`select s.id from workflow_step s join work_item w on w.workflow_version_id = s.workflow_version_id where w.id = ${item}::uuid order by s.id`)).map(
    (r) => r.id,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  const workflow = await addTestWorkflow(run, { name: bilingual(`RP-438 map ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Map (RP-438)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Map (RP-438)")), workflow, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2 } = tower;
  Object.assign(name, {
    [c1.members.project_manager]: "C1 PM",
    [c1.members.engineer]: "C1 engineer",
    [k1.members.engineer]: "K1 engineer",
    [k1.members.manager]: "K1 manager",
    [ow.members.representative]: "the Owner",
    [c2.members.engineer]: "C2 engineer",
  });

  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "CT-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  versionId = (await migrator.query("select workflow_version_id from work_item where id = $1", [item])).rows[0].workflow_version_id as string;
  for (const row of (await migrator.query<{ id: string; key: string }>("select id, key from workflow_step where workflow_version_id = $1", [versionId])).rows) stepId[row.key] = row.id;

  // C1 Submits it; K1's engineer picks it up at the Consultant's first Step.
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
  expect(await tower.pickUp(k1.members.engineer, item)).toBe("picked_up");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-438-1: View workflow", () => {
  it("C1 and the Owner read the Version whole, the item with K1, and K1's move to its manager changes nothing they read; K1 sees the manager's Step (V14, V20)", async () => {
    const { c1, k1, ow } = tower;
    const outside = [c1.members.project_manager, c1.members.engineer, ow.members.representative];
    const inside = [k1.members.engineer, k1.members.manager];

    // The pinned Version whole, for everyone who sees the item: every Step, K1's two included.
    const whole = (await migrator.query<{ id: string }>("select id from workflow_step where workflow_version_id = $1 order by id", [versionId])).rows.map((r) => r.id);
    expect(whole).toEqual(expect.arrayContaining([stepId.consultant_review, stepId.consultant_approval]));
    for (const reader of [...outside, ...inside]) expect(await versionSteps(reader), named(reader)).toEqual(whole);

    const before = new Map<string, Awaited<ReturnType<typeof whereAs>>>();
    for (const reader of outside) before.set(reader, await whereAs(reader));
    // No K1 Step for them, not even the one C1's Submit reached (RP-1192-1): K1 by its Participant only.
    for (const reader of outside) expect(before.get(reader), named(reader)).toEqual({ step_id: null, holder_mine: false, holder: k1.participantId });
    expect(await whereAs(k1.members.engineer)).toEqual({ step_id: stepId.consultant_review, holder_mine: true, holder: k1.participantId });

    expect(await tower.take(k1.members.engineer, item, "send_to_manager")).toBe("applied");

    // K1's Members read the manager's Step marked; the others still no Step, exactly as before.
    for (const reader of inside) expect((await whereAs(reader))?.step_id, named(reader)).toBe(stepId.consultant_approval);
    for (const reader of outside) expect(await whereAs(reader), named(reader)).toEqual(before.get(reader));
    const seenStep = async (as: string) => {
      const where = await whereAs(as);
      return where ? [{ id: where.step_id }] : [];
    };
    await expectHiddenFrom({ read: seenStep, target: stepId.consultant_approval!, seenBy: inside, hiddenFrom: outside, name: named, label: "the manager's Step marked" });
  });

  it("C2, who doesn't see the item, reads nothing of where it is", async () => {
    const { c1, c2 } = tower;
    const seenItem = async (as: string) => (await tower.call<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`)).map((r) => ({ id: r.id }));
    await expectHiddenFrom({ read: seenItem, target: item, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "the item" });
    const where = async (as: string) => ((await whereAs(as)) ? [{ id: item }] : []);
    await expectHiddenFrom({ read: where, target: item, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "where it is" });
  });
});
