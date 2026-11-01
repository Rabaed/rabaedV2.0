// Seam 2 for scenario RP-1192-1 (visibility.md V14), as the app role: while K1 holds C1's Submittal at
// either of its own Steps (Consultant review, where C1's Submit took it, and Consultant approval, after
// K1's own Send to Manager), C1 and the Owner Representative read no K1 Step, neither its id nor its
// name: not from app.step_as_seen (the item read, the map, the Panel), not from app.work_items_seen (the
// List row and the Kanban card) and not from app.work_item_history (`to_step_name` of C1's own Submit).
// They read K1 by its role only. K1's own Members read the Step (the positive control), and a closed
// item's terminal Step stays everyone's. Seam 1: apps/api/test/rp-1192-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `RQ${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const towerOptions = { projectCode: "RQS", k1Manager: true, checklistTemplate: false } as const;

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<typeof towerOptions>;
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

let atReview = ""; // Submitted by C1: at K1's Consultant review, picked up by K1's engineer.
let atApproval = ""; // The same, then sent to K1's manager inside K1: at Consultant approval.
let closed = ""; // The same, then closed by K1's manager with Code C.
/** The Workflow Version's Steps: key by id, and key by name. */
const keyOfId = new Map<string, string>();
const keyOfName = new Map<string, string>();

const keyed = (ids: (string | null)[]) => ids.flatMap((id) => (id === null ? [] : [{ id: keyOfId.get(id) ?? id }]));
const keyedNames = (namesRead: unknown[]) =>
  namesRead.flatMap((n) => (n === null ? [] : [{ id: keyOfName.get(JSON.stringify(n)) ?? JSON.stringify(n) }]));

/** The Step app.step_as_seen gives `as` for item `id` (the item read, its map and the Submittal Panel), by key. */
const stepAsSeen = (id: string) => async (as: string) =>
  keyed((await t.call<{ step_id: string | null }>(as, sql`select step_id from app.step_as_seen(${id}::uuid)`)).map((r) => r.step_id));
/** The Step app.work_items_seen gives `as` on item `id`'s List row (the List and the Kanban card), by key. */
const listStep = (id: string) => async (as: string) =>
  keyed(
    (
      await t.call<{ step_id: string | null }>(
        as,
        sql`select step_id from app.work_items_seen(${t.projectId}::uuid, array['submittals']::text[], false, ${[id]}::uuid[])`,
      )
    ).map((r) => r.step_id),
  );
/** The Steps app.work_item_history names to `as` on item `id`, by key. */
const historySteps = (id: string) => async (as: string) =>
  keyedNames(
    (await t.call<{ from_step_name: unknown; to_step_name: unknown }>(as, sql`select from_step_name, to_step_name from app.work_item_history(${id}::uuid)`)).flatMap(
      (r) => [r.from_step_name, r.to_step_name],
    ),
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflow = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1192 Step outside ${digits(6)}`) });
  const form = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Step outside (RP-1192)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    form,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Step outside (RP-1192)")), workflow, form],
  );
  t = await buildSeamTwoTower(app, migrator, towerOptions);
  for (const [as, name] of [
    [t.c1.members.engineer, "C1's engineer"],
    [t.c1.members.project_manager, "C1's PM"],
    [t.k1.members.engineer, "K1's engineer"],
    [t.k1.members.manager, "K1's manager"],
    [t.ow.members.representative, "the Owner Representative"],
  ] as const)
    names.set(as, name);

  const atConsultant = async (title: string) => {
    const [draft] = await t.call<{ outcome: string; work_item_id: string }>(
      t.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
        ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
    );
    expect(draft!.outcome).toBe("created");
    const id = draft!.work_item_id;
    expect(await t.take(t.c1.members.engineer, id, "send_for_review")).toBe("applied");
    expect(await t.pickUp(t.c1.members.project_manager, id)).toBe("picked_up");
    expect(await t.take(t.c1.members.project_manager, id, "submit")).toBe("applied");
    expect(await t.pickUp(t.k1.members.engineer, id)).toBe("picked_up");
    return id;
  };
  const toApproval = async (id: string) => {
    expect(await t.take(t.k1.members.engineer, id, "send_to_manager")).toBe("applied");
    const held = (await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [id])).rows[0];
    if (held?.assignee_member_id !== t.k1.members.manager) expect(await t.pickUp(t.k1.members.manager, id)).toBe("picked_up");
    return id;
  };
  atReview = await atConsultant("Cable tray risers");
  atApproval = await toApproval(await atConsultant("Busbar trunking"));
  closed = await toApproval(await atConsultant("Gaskets"));
  expect(await t.take(t.k1.members.manager, closed, "revise_c")).toBe("applied");

  const { rows } = await migrator.query("select s.key, s.id, s.name from work_item w join workflow_step s on s.workflow_version_id = w.workflow_version_id where w.id = $1", [atReview]);
  for (const r of rows as { key: string; id: string; name: unknown }[]) {
    keyOfId.set(r.id, r.key);
    keyOfName.set(JSON.stringify(r.name), r.key);
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1192-1: K1 holds C1's Submittal at one of K1's own Steps", () => {
  const outside = () => [t.c1.members.engineer, t.c1.members.project_manager, t.ow.members.representative];
  const k1 = () => [t.k1.members.engineer, t.k1.members.manager];

  for (const [label, item, target] of [
    ["Consultant review, where C1's Submit took it", () => atReview, "consultant_review"],
    ["Consultant approval, after K1's Send to Manager", () => atApproval, "consultant_approval"],
  ] as const) {
    describe(`at ${label}`, () => {
      it("app.step_as_seen gives C1 and the Owner Representative no Step, and K1 its own", async () => {
        await expectHiddenFrom({ read: stepAsSeen(item()), target, seenBy: k1(), hiddenFrom: outside(), name: named, label: "app.step_as_seen" });
        // Nothing of K1's Steps at all, not even the one C1's Submit reached.
        for (const as of outside()) expect(await stepAsSeen(item())(as), named(as)).toEqual([]);
      });

      it("app.step_as_seen gives everyone the holding role, and the Stage", async () => {
        for (const as of [...outside(), ...k1()]) {
          const read = await t.call<{ holder_role: string | null; stage_key: string }>(as, sql`select holder_role, stage_key from app.step_as_seen(${item()}::uuid)`);
          expect(read, named(as)).toEqual([{ holder_role: "consultant", stage_key: expect.any(String) }]);
        }
      });

      it("app.work_items_seen (the List row and the Kanban card) gives C1 and the Owner Representative no Step, and K1 its own", async () => {
        await expectHiddenFrom({ read: listStep(item()), target, seenBy: k1(), hiddenFrom: outside(), name: named, label: "app.work_items_seen" });
        for (const as of outside()) expect(await listStep(item())(as), named(as)).toEqual([]);
      });
    });
  }

  it("app.work_item_history names no K1 Step to C1 or the Owner Representative, the one C1's own Submit reached included", async () => {
    for (const target of ["consultant_review", "consultant_approval"]) {
      await expectHiddenFrom({ read: historySteps(atApproval), target, seenBy: k1(), hiddenFrom: outside(), name: named, label: `the history's ${target}` });
    }
    // C1 still reads its own Steps on its own events: the Step its Submit left.
    for (const as of [t.c1.members.engineer, t.c1.members.project_manager]) {
      expect((await historySteps(atApproval)(as)).map((r) => r.id), named(as)).toContain("internal_review");
    }
  });

  it("a closed item's terminal Step stays everyone's", async () => {
    for (const as of [...outside(), ...k1()]) {
      expect(await stepAsSeen(closed)(as), named(as)).toEqual([{ id: "revise_resubmit" }]);
      expect(await listStep(closed)(as), named(as)).toEqual([{ id: "revise_resubmit" }]);
    }
  });
});
