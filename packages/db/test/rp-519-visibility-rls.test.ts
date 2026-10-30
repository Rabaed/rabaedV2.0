// Seam 2 for a Stage's Steps on the Kanban (RP-519, ADR 0020; visibility.md V14; scenario RP-519-1), as the app
// role. The board reads app.work_items_seen (apps/api/src/work-items/query.ts, visibleRows) and names, with its count,
// the Step of each row its own Participant holds; a row another Participant holds is that Company's lane, no Step.
// C1 runs a Workflow whose Internal Review Stage has two Steps, Contractor Engineer and Contractor review (the PM's):
// two items wait at the PM's, one is Returned to the Engineer's, one is Submitted to K1. C1 reads its three at its own
// Steps (the Engineer 1, the PM 2); K1's manager reads none of them and no row at either of C1's Steps, so no TMC Step
// name or count, in either language, can reach it. K1 reads the Submitted one at its own Step; C1 reads it as K1's,
// with no Step of its own. Seam 1: apps/api/test/work-item-board-steps.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RB${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RBS", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
const item = { atPm: [] as string[], returned: "", submitted: "" };
/** The Workflow's Steps by key: their ids. */
const step = { engineer: "", review: "", consultant: "" };
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

type BoardRow = { id: string; step_id: string; stage_key: string; held_by_own: boolean };
/** The Kanban's rows as `as` reads them: app.work_items_seen as the api's board reads it, with whether the holder is the reader's own Participant. */
const board = (as: string) =>
  tower.call<BoardRow>(
    as,
    sql`select w.id, w.step_id, w.stage_key, coalesce(w.holder_participant_id in (select app.current_participant_ids()), false) as held_by_own
      from app.work_items_seen(${tower.projectId}::uuid, array['submittals']::text[], false, null) w`,
  );
/** The Steps `as`'s board names: those of the rows its own Participant holds, one row per Step's id. */
const ownSteps = async (as: string) => (await board(as)).filter((r) => r.held_by_own).map((r) => ({ id: r.step_id }));
/** Stage `stage`'s own Steps on `as`'s board, with their counts, by Step id. */
async function stepCounts(as: string, stage: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const r of await board(as)) if (r.held_by_own && r.stage_key === stage) counts[r.step_id] = (counts[r.step_id] ?? 0) + 1;
  return counts;
}

/** C1's Engineer raises an item and sends it to C1's review, where it waits at the PM's Step; returns its id. */
async function atPm(title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  expect(await tower.take(tower.c1.members.engineer, created!.work_item_id, "send_for_review")).toBe("applied");
  return created!.work_item_id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { engineerStep: true, name: bilingual(`RP-519 board Steps ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Board Steps (RP-519)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Board Steps (RP-519)")), workflowId, formId],
  );
  const steps = (
    await migrator.query(
      "select s.id, s.key from workflow_step s join workflow_version v on v.id = s.workflow_version_id where v.workflow_definition_id = $1",
      [workflowId],
    )
  ).rows as { id: string; key: string }[];
  const stepId = (key: string) => steps.find((s) => s.key === key)!.id;
  step.engineer = stepId("contractor_engineer");
  step.review = stepId("internal_review");
  step.consultant = stepId("consultant_review");

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "Hafiz (C1 engineer)"],
    [c1.members.project_manager, "Ali (C1 PM)"],
    [k1.members.engineer, "K1 engineer"],
    [k1.members.manager, "K1 manager"],
  ] as const)
    names.set(as, name);

  // Two at the PM's Step, one Returned to the Engineer's, one Submitted to K1.
  item.atPm = [await atPm("Tray A"), await atPm("Tray B")];
  item.returned = await atPm("Tray C");
  expect(await tower.pickUp(c1.members.project_manager, item.returned)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item.returned, "return")).toBe("applied");
  item.submitted = await atPm("Tray D");
  expect(await tower.pickUp(c1.members.project_manager, item.submitted)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item.submitted, "submit")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-519-1: C1's Internal Review Steps on the Kanban, at seam 2", () => {
  it("C1 reads its own items at its own Steps, with their counts: the Engineer 1, the PM 2", async () => {
    for (const as of [tower.c1.members.engineer, tower.c1.members.project_manager]) {
      const rows = (await board(as)).filter((r) => r.stage_key === "internal_review");
      expect(rows.map((r) => [r.id, r.step_id, r.held_by_own]).sort()).toEqual(
        [
          [item.atPm[0], step.review, true],
          [item.atPm[1], step.review, true],
          [item.returned, step.engineer, true],
        ].sort(),
      );
      expect(await stepCounts(as, "internal_review")).toEqual({ [step.engineer]: 1, [step.review]: 2 });
    }
  });

  it("K1's manager reads none of C1's Internal Review items, and no row at either of C1's Steps", async () => {
    const { c1, k1 } = tower;
    const c1Members = [c1.members.engineer, c1.members.project_manager];
    const k1Members = [k1.members.manager, k1.members.engineer];
    for (const id of [...item.atPm, item.returned]) {
      await expectHiddenFrom({ read: board, target: id, seenBy: c1Members, hiddenFrom: k1Members, name: named, label: "C1's Internal Review item on the board" });
    }
    // No row at C1's Steps at all, so the board has no TMC Step name or per-Step count to give K1 (V14).
    const rowSteps = async (as: string) => (await board(as)).map((r) => ({ id: r.step_id }));
    for (const id of [step.engineer, step.review]) {
      await expectHiddenFrom({ read: rowSteps, target: id, seenBy: c1Members, hiddenFrom: k1Members, name: named, label: "a row at C1's Step" });
    }
  });

  it("K1 reads the Submitted item at its own Step; C1 reads it as K1's, a Company lane with no Step", async () => {
    const { c1, k1 } = tower;
    expect(await stepCounts(k1.members.manager, "pending_approval")).toEqual({ [step.consultant]: 1 });
    for (const as of [c1.members.engineer, c1.members.project_manager]) {
      expect((await board(as)).find((r) => r.id === item.submitted)).toMatchObject({ stage_key: "pending_approval", held_by_own: false });
    }
    await expectHiddenFrom({
      read: ownSteps,
      target: step.consultant,
      seenBy: k1.members.manager,
      hiddenFrom: [c1.members.engineer, c1.members.project_manager],
      name: named,
      label: "K1's Step, named on the board",
    });
  });
});
