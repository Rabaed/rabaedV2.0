// Seam 2 for the Positions the Work Item history gives (RP-1091, spec RP-1054; visibility.md V5,
// V14, the "Work Item history" row; scenarios RP-1091-1 to RP-1091-3). app.work_item_history names
// an event's actor with their Position only when the actor is a Member of the reader's own
// Participant: the Positions they held when the event was written (its work_item_event_signer row,
// kept for a Transition or a Code), else their current Project Positions. Another Company's actor
// gets none, and neither does the final Code's signer, who alone of them is named (V14). Seam 1:
// apps/api/test/history-positions.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RH${letters(3)}`;

/** The Rabaed Default Positions, as the read names them. */
const ENGINEER = { en: "Engineer", ar: "مهندس" };
const PROJECT_MANAGER = { en: "Project Manager", ar: "مدير المشروع" };
const MANAGER = { en: "Manager", ar: "مدير" };

type Row = {
  seq: number;
  type: string;
  audience: string;
  company_name: { en: string } | null;
  member_name: { en: string } | null;
  member_positions: { en: string; ar: string }[] | null;
  from_step_name: { en: string } | null;
  to_step_name: { en: string } | null;
  transition_label: { en: string } | null;
};

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RHP", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let id = "";

/** Item `item`'s history as Member `as` reads it. */
const historyOf = (as: string, item: string) =>
  tower.call<Row>(
    as,
    sql`select seq, type, audience, company_name, member_name, member_positions, from_step_name, to_step_name, transition_label
      from app.work_item_history(${item}::uuid)`,
  );

/** Each row as [type, Company, person, Positions], for one assertion. */
const who = (rows: readonly Row[]) => rows.map((r) => [r.type, r.company_name?.en ?? null, r.member_name?.en ?? null, r.member_positions]);

const names = new Map<string, string>();
const nameOf = (as: string) => names.get(as) ?? as;

/**
 * The Position and Step names `as` reads anywhere in item `item`'s history. A name is the row here:
 * the read gives a Position or a Step no id, and the name is what V14 keeps from another Company.
 */
const labelsOf = async (as: string, item: string) =>
  (await historyOf(as, item)).flatMap((r) => [...(r.member_positions ?? []).map((p) => p.en), r.from_step_name?.en, r.to_step_name?.en]).flatMap((label) => (label ? [{ id: label }] : []));

/**
 * Item `item`'s event ids in its history as `as` reads it. app.work_item_history gives a row no id (its
 * seq counts only what the reader sees), so each row is matched to the migrator's event of its type and time.
 */
async function historyIdsOf(as: string, item: string): Promise<{ id: string }[]> {
  const events = (await migrator.query("select id, type, created_at from work_item_event where work_item_id = $1", [item])).rows as { id: string; type: string; created_at: Date }[];
  const rows = await tower.call<{ type: string; created_at: Date }>(as, sql`select type, created_at from app.work_item_history(${item}::uuid)`);
  return rows.flatMap((r) => events.filter((e) => e.type === r.type && e.created_at.getTime() === r.created_at.getTime()).map((e) => ({ id: e.id })));
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1091 history positions ${digits(6)}`) });
  const formId = (
    await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("History positions (RP-1091)"))])
  ).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("History positions (RP-1091)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1's engineer"],
    [c1.members.project_manager, "C1's PM"],
    [k1.members.engineer, "K1's engineer"],
    [k1.members.manager, "K1's manager"],
    [tower.c2.members.engineer, "C2's engineer"],
  ] as const)
    names.set(as, name);

  // C1's Engineer raises it and sends it for review; C1's PM Submits it; K1's Engineer sends it to K1's Manager, who issues Code A.
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "CT-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  id = created!.work_item_id;
  expect(await tower.take(c1.members.engineer, id, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
  expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
  expect(await tower.take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
  expect(await tower.take(k1.members.manager, id, "approve_a")).toBe("applied");

  // Afterwards C1's PM is made an Engineer: a Transition keeps the Position held when it was taken, a pick-up records none.
  expect(
    await tower.outcome(c1.ap, sql`select app.set_project_member_positions(${c1.participantId}::uuid, ${c1.members.project_manager}::uuid, ${["engineer"]}::text[]) as outcome`),
  ).toBe("set");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1091-1: C1's engineer reads the history of a C1 item K1 reviewed and Coded", () => {
  let rows: Row[] = [];
  beforeAll(async () => {
    rows = await historyOf(tower.c1.members.engineer, id);
  });

  it("names C1's people with their Position: the one held for a Transition, else the one they hold now", () => {
    expect(who(rows.filter((r) => r.company_name?.en === "C1"))).toEqual([
      ["transition", "C1", "engineer", [ENGINEER]],
      // A pick-up records no Position: the PM's Position now.
      ["assigned", "C1", "project_manager", [ENGINEER]],
      ["transition", "C1", "project_manager", [PROJECT_MANAGER]],
    ]);
  });

  it("gives no K1 event a Position, a person or a Step name, but the Code's signer by name, with no Position", async () => {
    const k1 = rows.filter((r) => r.company_name?.en === "K1");
    expect(k1.map((r) => [r.type, r.audience, r.member_name?.en ?? null, r.member_positions, r.from_step_name, r.to_step_name])).toEqual([
      ["issue_code", "shared", "manager", null, null, null],
    ]);
    expect(rows.every((r) => r.company_name !== null)).toBe(true);
    // K1's manager reads their own Position and K1's Step in the same history; C1's engineer reads neither.
    for (const target of [MANAGER.en, "Consultant approval"]) {
      await expectHiddenFrom({ read: (as: string) => labelsOf(as, id), target, seenBy: tower.k1.members.manager, hiddenFrom: tower.c1.members.engineer, name: nameOf, label: "K1's names" });
    }
  });
});

describe("scenario RP-1091-2: K1 reads the same history", () => {
  let rows: Row[] = [];
  beforeAll(async () => {
    rows = await historyOf(tower.k1.members.manager, id);
  });

  it("names K1's people with their Position", () => {
    expect(who(rows.filter((r) => r.company_name?.en === "K1"))).toEqual([
      ["picked_up", "K1", "engineer", [ENGINEER]],
      ["transition", "K1", "engineer", [ENGINEER]],
      ["assigned", "K1", "manager", [MANAGER]],
      ["issue_code", "K1", "manager", [MANAGER]],
    ]);
  });

  it("gives C1's Submit no C1 Position, no person and no C1 Step name", async () => {
    const c1 = rows.filter((r) => r.company_name?.en === "C1");
    expect(c1.map((r) => [r.type, r.member_name, r.member_positions, r.from_step_name, r.to_step_name, r.transition_label?.en])).toEqual([
      ["transition", null, null, null, null, "Submit"],
    ]);
    // C1's engineer reads C1's Position and Step names in the same history; K1's manager reads neither.
    for (const target of [PROJECT_MANAGER.en, "Contractor review"]) {
      await expectHiddenFrom({ read: (as: string) => labelsOf(as, id), target, seenBy: tower.c1.members.engineer, hiddenFrom: tower.k1.members.manager, name: nameOf, label: "C1's names" });
    }
  });
});

// app.history_actor_positions is a definer the app role may call itself: called directly, it gives
// no more than the history does (CODING_STANDARDS › Visibility, "Side channels"). The `created`
// event's id is a uuid_v7 carrying the Draft's start, read by nobody through the app role.
describe("app.history_actor_positions called directly (RP-1091-1 to RP-1091-3)", () => {
  /** The event ids `as` gets for item `item`. */
  const idsOf = async (as: string, item: string) =>
    (await tower.call<{ event_id: string }>(as, sql`select event_id from app.history_actor_positions(${item}::uuid)`)).map((r) => r.event_id).sort();
  /** Item `item`'s event ids by Participant, as the migrator reads them. */
  const eventsOf = async (item: string, participantId: string, created: boolean) =>
    (
      await migrator.query("select id from work_item_event where work_item_id = $1 and actor_participant_id = $2 and (type = 'created') = $3", [
        item,
        participantId,
        created,
      ])
    ).rows
      .map((r) => r.id as string)
      .sort();

  it("gives C1's engineer C1's events but never the `created` one (the positive control)", async () => {
    const [createdId] = await eventsOf(id, tower.c1.participantId, true);
    expect(createdId).toBeDefined();
    const c1Events = await eventsOf(id, tower.c1.participantId, false);
    expect(c1Events).toHaveLength(3); // not hidden-from: the migrator's count of C1's events, the setup
    const ids = await idsOf(tower.c1.members.engineer, id);
    expect(ids).toEqual(c1Events);
    expect(ids).not.toContain(createdId); // not hidden-from: the `created` event is read by nobody, C1 included (audit only); the line above proves the read gives C1's other events
  });

  /** The event ids `as` reads through app.history_actor_positions, as rows. */
  const read = async (as: string) => (await idsOf(as, id)).map((e) => ({ id: e }));

  it("gives K1's manager no C1 event, the `created` one included", async () => {
    const [createdId] = await eventsOf(id, tower.c1.participantId, true);
    const ids = await idsOf(tower.k1.members.manager, id);
    expect(ids).toEqual(await eventsOf(id, tower.k1.participantId, false));
    expect(ids).not.toContain(createdId); // not hidden-from: the `created` event is read by nobody (audit only); the other C1 events are proved below
    for (const target of await eventsOf(id, tower.c1.participantId, false)) {
      await expectHiddenFrom({ read, target, seenBy: tower.c1.members.engineer, hiddenFrom: tower.k1.members.manager, name: nameOf, label: "a C1 event" });
    }
  });

  it("gives C2's engineer nothing of C1's item", async () => {
    const { c1, k1, c2 } = tower;
    for (const [participantId, seenBy] of [
      [c1.participantId, c1.members.engineer],
      [k1.participantId, k1.members.manager],
    ] as const) {
      for (const target of await eventsOf(id, participantId, false)) {
        await expectHiddenFrom({ read, target, seenBy, hiddenFrom: c2.members.engineer, name: nameOf, label: "an event of C1's item" });
      }
    }
  });
});

describe("scenario RP-1091-3: a Member of a third Company on the Project", () => {
  it("reads nothing of C1's item's history, nor of a made-up id", async () => {
    const { c1, k1, c2 } = tower;
    // Each event of C1's item is read in its history by a Member of the Participant whose event it is; never by C2.
    const events = (await migrator.query("select id, actor_participant_id from work_item_event where work_item_id = $1 and type <> 'created'", [id])).rows as {
      id: string;
      actor_participant_id: string;
    }[];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const seenBy = event.actor_participant_id === k1.participantId ? k1.members.manager : c1.members.engineer;
      await expectHiddenFrom({ read: (as: string) => historyIdsOf(as, id), target: event.id, seenBy, hiddenFrom: c2.members.engineer, name: nameOf, label: "C1's item's history" });
    }
    expect(await historyOf(c2.members.engineer, randomUUID())).toEqual([]); // not hidden-from: a made-up id, no item for anyone
  });

  it("reads its own item's history, its own people with each of their Positions (the positive control)", async () => {
    const { c2 } = tower;
    // C2's Engineer is its Project Manager too, so its review is a pool of one.
    expect(
      await tower.outcome(c2.ap, sql`select app.set_project_member_positions(${c2.participantId}::uuid, ${c2.members.engineer}::uuid, ${["engineer", "project_manager"]}::text[]) as outcome`),
    ).toBe("set");
    const own = await c2Draft(tower, { type: TYPE, title: "Conduits" });
    expect(await tower.take(c2.members.engineer, own, "send_for_review")).toBe("applied");
    expect(who(await historyOf(c2.members.engineer, own))).toEqual([
      ["transition", "C2", "engineer", [ENGINEER, PROJECT_MANAGER]],
      ["assigned", "C2", "engineer", [ENGINEER, PROJECT_MANAGER]],
    ]);
  });
});
