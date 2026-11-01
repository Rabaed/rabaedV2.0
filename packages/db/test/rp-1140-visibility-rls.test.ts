// Seam 2 for scenario RP-1140-1 (visibility.md V5, V14), as the app role: K1 moves C1's Submittal inside
// K1 (Send to Manager) and then closes it with a Code from there. The Step K1's own move took it to,
// Consultant approval, is K1's: C1 reads the item at the Step C1's shared Submit brought it to, and of
// K1's shared close the Step it reached, never the Step it left. Until RP-1140 the api alone kept it from
// C1 (its history names an event's Steps only to the actor's own Participant), while the database gave
// the close's from_step_id to anyone who read the event. And the same the other way: K1 never reads
// C1's internal review, the Step C1's Submit left. Seam 1: apps/api/test/rp-1140-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
// A test Type on the test Workflow, whose Consultant review sends to K1's own Consultant approval: a move inside K1.
const TYPE = `RL${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const towerOptions = { projectCode: "RLS", k1Manager: true, checklistTemplate: false } as const;

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<typeof towerOptions>;
let c1Engineer = "";
let c1Pm = "";
let k1Engineer = "";
let k1Manager = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

let atApproval = ""; // Submitted, sent to K1's manager by K1's engineer, picked up by K1's manager.
let closed = ""; // The same, then closed by K1's manager with Code C from Consultant approval.
const steps = new Map<string, string>(); // The Workflow Version's Steps by key.
const step = (key: string) => steps.get(key) ?? key;

/** Every event of both items, as the migrator reads them: what app.event_transitions is asked about. */
const eventIds = async () =>
  ((await migrator.query("select id from work_item_event where work_item_id = any($1::uuid[])", [[atApproval, closed]])).rows as { id: string }[]).map((r) => r.id);
/**
 * Every Step id `as` reads from the items' events: in the columns of work_item_event the app role is granted
 * (none of its Step columns since RP-1203; through its Transition when `transition_id` is one, as a Transition
 * leaves one Step), and the Step each event reached, as app.event_steps_reached gives it.
 */
const eventSteps = async (as: string) => {
  const { rows } = await migrator.query(
    `select column_name from information_schema.column_privileges
     where grantee = 'rabaed_app' and privilege_type = 'SELECT' and table_schema = 'public' and table_name = 'work_item_event'
       and column_name in ('from_step_id', 'to_step_id', 'transition_id')`,
  );
  const granted = new Set((rows as { column_name: string }[]).map((r) => r.column_name));
  const columns = [
    ...["from_step_id", "to_step_id"].filter((c) => granted.has(c)).map((c) => sql.ref(`e.${c}`)),
    ...(granted.has("transition_id") ? [sql`tr.from_step_id as transition_from`, sql`tr.to_step_id as transition_to`] : []),
  ];
  const read = columns.length
    ? await t.call<Record<string, string | null>>(
        as,
        sql`select ${sql.join(columns)} from work_item_event e
          ${granted.has("transition_id") ? sql`left join workflow_transition tr on tr.id = e.transition_id` : sql``}
          where e.work_item_id = any(${[atApproval, closed]}::uuid[])`,
      )
    : [];
  const reached = await t.call<{ to_step_id: string | null }>(as, sql`select to_step_id from app.event_steps_reached(${await eventIds()}::uuid[])`);
  return [...read, ...reached].flatMap((r) => Object.values(r).flatMap((v) => (v ? [{ id: v }] : [])));
};
/** The Steps app.event_transitions gives `as` for the items' events: each Step an event left, and its Transition's Steps. */
const transitionSteps = async (as: string) =>
  t.call<{ id: string }>(
    as,
    sql`select s.id from app.event_transitions(${await eventIds()}::uuid[]) x
      left join workflow_transition tr on tr.id = x.transition_id
      cross join lateral (values (x.from_step_id), (tr.from_step_id), (tr.to_step_id)) s (id)
      where s.id is not null`,
  );
/** The Steps app.work_item_history names to `as`, as the Steps of the item's Workflow Version they name. */
const historySteps = async (as: string) => {
  const { rows } = await migrator.query("select id, name from workflow_step where id = any($1::uuid[])", [[...steps.values()]]);
  const byName = new Map((rows as { id: string; name: unknown }[]).map((r) => [JSON.stringify(r.name), r.id]));
  const read = (
    await Promise.all(
      [atApproval, closed].map((id) =>
        t.call<{ from_step_name: unknown; to_step_name: unknown }>(as, sql`select from_step_name, to_step_name from app.work_item_history(${id}::uuid)`),
      ),
    )
  ).flat();
  return read.flatMap((r) => [r.from_step_name, r.to_step_name].flatMap((n) => (n === null ? [] : [{ id: byName.get(JSON.stringify(n)) ?? JSON.stringify(n) }])));
};
/** The Step the item is at, as app.work_items_seen (the List and the Kanban) and app.step_as_seen give it to `as`. */
const atStep = async (as: string) => [
  ...(await t.call<{ id: string }>(
    as,
    sql`select step_id as id from app.work_items_seen(${t.projectId}::uuid, array['submittals']::text[], false, ${[atApproval]}::uuid[])`,
  )),
  ...(await t.call<{ id: string }>(as, sql`select step_id as id from app.step_as_seen(${atApproval}::uuid)`)),
];

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflow = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1140 later Step ${digits(6)}`) });
  const form = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Later Step (RP-1140)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    form,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Later Step (RP-1140)")), workflow, form],
  );
  t = await buildSeamTwoTower(app, migrator, towerOptions);
  c1Engineer = t.c1.members.engineer;
  c1Pm = t.c1.members.project_manager;
  k1Engineer = t.k1.members.engineer;
  k1Manager = t.k1.members.manager;
  for (const [as, name] of [
    [c1Engineer, "C1's engineer"],
    [c1Pm, "C1's PM"],
    [k1Engineer, "K1's engineer"],
    [k1Manager, "K1's manager"],
  ] as const)
    names.set(as, name);

  const toApproval = async (title: string) => {
    const [draft] = await t.call<{ outcome: string; work_item_id: string }>(
      c1Engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
        ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
    );
    expect(draft!.outcome).toBe("created");
    const id = draft!.work_item_id;
    expect(await t.take(c1Engineer, id, "send_for_review")).toBe("applied");
    expect(await t.pickUp(c1Pm, id)).toBe("picked_up");
    expect(await t.take(c1Pm, id, "submit")).toBe("applied");
    // K1's engineer reviews it and sends it to K1's manager: a move inside K1 (V5).
    expect(await t.pickUp(k1Engineer, id)).toBe("picked_up");
    expect(await t.take(k1Engineer, id, "send_to_manager")).toBe("applied");
    const held = (await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [id])).rows[0];
    if (held?.assignee_member_id !== k1Manager) expect(await t.pickUp(k1Manager, id)).toBe("picked_up");
    return id;
  };
  atApproval = await toApproval("Fixtures");
  closed = await toApproval("Gaskets");
  expect(await t.take(k1Manager, closed, "revise_c")).toBe("applied");

  const { rows } = await migrator.query("select s.key, s.id from work_item w join workflow_step s on s.workflow_version_id = w.workflow_version_id where w.id = $1", [atApproval]);
  for (const r of rows as { key: string; id: string }[]) steps.set(r.key, r.id);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1140-1: K1 moves C1's Submittal inside K1 and closes it from there", () => {
  const c1 = () => [c1Engineer, c1Pm];
  const k1 = () => [k1Engineer, k1Manager];

  it("work_item_event gives C1 no Step K1 reached after the Submit, nor K1 the Step C1's Submit left", async () => {
    // K1 reads its own move to Consultant approval; C1 reads neither it nor the close leaving from there.
    await expectHiddenFrom({ read: eventSteps, target: step("consultant_approval"), seenBy: k1(), hiddenFrom: c1(), name: named, label: "K1's Consultant approval" });
    await expectHiddenFrom({ read: eventSteps, target: step("internal_review"), seenBy: c1(), hiddenFrom: k1(), name: named, label: "C1's internal review" });
  });

  it("app.event_transitions gives each viewer an event's Transition and the Step it left only for its own Participant's events, and everyone its label", async () => {
    await expectHiddenFrom({ read: transitionSteps, target: step("consultant_approval"), seenBy: k1(), hiddenFrom: c1(), name: named, label: "the Step K1's close left" });
    await expectHiddenFrom({ read: transitionSteps, target: step("internal_review"), seenBy: c1(), hiddenFrom: k1(), name: named, label: "the Step C1's Submit left" });
    // The close is shared: C1 reads what K1 did ("Revise · C", a close), as the history and the feed show it.
    const close = (await migrator.query("select id from work_item_event where work_item_id = $1 and type = 'issue_code'", [closed])).rows[0].id as string;
    for (const as of c1()) {
      const read = await t.call<{ transition_id: string | null; from_step_id: string | null; label: unknown; kind: string }>(
        as,
        sql`select transition_id, from_step_id, label, kind from app.event_transitions(${[close]}::uuid[])`,
      );
      expect(read, named(as)).toEqual([{ transition_id: null, from_step_id: null, label: { en: "Revise · C", ar: "مراجعة · C" }, kind: "close" }]);
    }
  });

  it("app.work_item_history names Consultant approval to K1 only", async () => {
    await expectHiddenFrom({ read: historySteps, target: step("consultant_approval"), seenBy: k1(), hiddenFrom: c1(), name: named, label: "the history's Steps" });
  });

  it("the List, the Kanban and the item read C1 no K1 Step, not even the one its Submit reached (RP-1192-1), and K1 its own", async () => {
    await expectHiddenFrom({ read: atStep, target: step("consultant_approval"), seenBy: k1(), hiddenFrom: c1(), name: named, label: "the Step it is at" });
    for (const as of c1()) expect(await atStep(as), named(as)).toEqual([{ id: null }, { id: null }]);
  });

  // RP-1203: C1 read K1's Consultant review here, where C1's own Submit took the item, until the app role lost to_step_id.
  it("C1 reads where the close took the item, its terminal Step, but not K1's Consultant review, where its Submit took it", async () => {
    const closedStep = (await migrator.query("select current_step_id from work_item where id = $1", [closed])).rows[0].current_step_id as string;
    await expectHiddenFrom({ read: eventSteps, target: step("consultant_review"), seenBy: k1(), hiddenFrom: c1(), name: named, label: "K1's Consultant review" });
    for (const as of [...c1(), ...k1()]) expect((await eventSteps(as)).map((r) => r.id), named(as)).toContain(closedStep);
  });
});
