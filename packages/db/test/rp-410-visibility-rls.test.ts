// Seam 2 for the List's and the Kanban's filter panel and lanes (RP-410, spec RP-447; visibility.md V5,
// V14, "Creation Date", the Lists/Kanban and "Search and filters" channels, scenario RP-410-1), as the app
// role. The panel's Owner, Role and Created date, and the Kanban's lanes, are built from what
// app.work_items_seen gives each viewer: the holder's person only for the viewer's own Participant's Steps,
// the Step as the viewer may know it, the Creation Date only to the raiser's Participant; and from
// member and project_member_position, which RLS gives one's own Company's people and Positions only. So
// nothing of another Company's people, Positions or Steps reaches an answer. Seam 1 (the panel's options,
// the filters' matches, the lanes and the closed card as the API shows them):
// apps/api/test/work-item-board-rebuild.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
// A test Type on the test Workflow, whose Consultant review sends to K1's own Consultant approval: a move inside K1.
const TYPE = `RK${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const towerOptions = { projectCode: "RKB", k1Manager: true, checklistTemplate: false } as const;

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<typeof towerOptions>;
let c1Engineer = "";
let c1Pm = "";
let k1Engineer = "";
let k1Manager = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

let inReview = ""; // In C1's internal review, picked up by C1's PM.
let withK1 = ""; // Submitted, picked up by K1's manager.
let closed = ""; // Closed by K1's manager with Code C.

type Seen = { id: string; step_id: string; holder_participant_id: string | null; holder_member_id: string | null; creation_date: Date | null; submitted_at: Date | null };
/** The Tower's Submittals as app.work_items_seen gives them to `as`: what the List and the Kanban read. */
const seen = (as: string) =>
  t.call<Seen>(
    as,
    sql`select id, step_id, holder_participant_id, holder_member_id, creation_date, submitted_at
      from app.work_items_seen(${t.projectId}::uuid, array['submittals']::text[], false, null)`,
  );
const stepOf = async (id: string) => (await migrator.query("select current_step_id from work_item where id = $1", [id])).rows[0].current_step_id as string;
const projectMemberOf = async (memberId: string) =>
  (await migrator.query("select id from project_member where project_id = $1 and member_id = $2", [t.projectId, memberId])).rows[0].id as string;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflow = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-410 board ${digits(6)}`) });
  const form = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Board (RP-410)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    form,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Board (RP-410)")), workflow, form],
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

  const raise = async (title: string) => {
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
    return id;
  };
  const toK1 = async (title: string) => {
    const id = await raise(title);
    expect(await t.take(c1Pm, id, "submit")).toBe("applied");
    // K1's engineer reviews it and sends it to K1's manager: a move inside K1 (V5).
    expect(await t.pickUp(k1Engineer, id)).toBe("picked_up");
    expect(await t.take(k1Engineer, id, "send_to_manager")).toBe("applied");
    const held = (await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [id])).rows[0];
    if (held?.assignee_member_id !== k1Manager) expect(await t.pickUp(k1Manager, id)).toBe("picked_up");
    return id;
  };
  inReview = await raise("Cable trays");
  withK1 = await toK1("Fixtures");
  closed = await toK1("Gaskets");
  expect(await t.take(k1Manager, closed, "revise_c")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-410-1: the filter panel's Owner, Role and Created date, and the Kanban's lanes", () => {
  it("Owner: gives each viewer only their own Company's holders; another Company's item is held by that Company alone (V14)", async () => {
    const holders = async (as: string) => (await seen(as)).filter((r) => r.holder_member_id !== null).map((r) => ({ id: r.holder_member_id! }));
    await expectHiddenFrom({ read: holders, target: k1Manager, seenBy: [k1Engineer, k1Manager], hiddenFrom: [c1Engineer, c1Pm], name: named, label: "K1's manager as a holder" });
    await expectHiddenFrom({ read: holders, target: c1Pm, seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1Engineer, k1Manager], name: named, label: "C1's PM as a holder" });
    // C1 reads the item K1's manager holds as K1's, by its Participant only: what the panel offers by name.
    expect((await seen(c1Engineer)).find((r) => r.id === withK1)).toMatchObject({ holder_participant_id: t.k1.participantId, holder_member_id: null });
    expect((await seen(k1Engineer)).find((r) => r.id === withK1)).toMatchObject({ holder_participant_id: t.k1.participantId, holder_member_id: k1Manager });
  });

  it("Owner: reads another Company's person by no name: member gives each viewer their own Company's people only", async () => {
    const people = (as: string) => t.call<{ id: string }>(as, sql`select id from member where id = any(${[c1Pm, k1Manager]}::uuid[])`);
    await expectHiddenFrom({ read: people, target: k1Manager, seenBy: k1Engineer, hiddenFrom: c1Engineer, name: named, label: "K1's manager" });
    await expectHiddenFrom({ read: people, target: c1Pm, seenBy: c1Engineer, hiddenFrom: k1Engineer, name: named, label: "C1's PM" });
  });

  it("Role: gives each viewer only their own Company's Steps: C1 never the Step K1 holds it at, nor K1 C1's internal review (V5)", async () => {
    const steps = async (as: string) => (await seen(as)).map((r) => ({ id: r.step_id }));
    // K1's manager holds it at Consultant approval, where K1's own move took it.
    await expectHiddenFrom({ read: steps, target: await stepOf(withK1), seenBy: [k1Engineer, k1Manager], hiddenFrom: [c1Engineer, c1Pm], name: named, label: "K1's Consultant approval" });
    await expectHiddenFrom({ read: steps, target: await stepOf(inReview), seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1Engineer, k1Manager], name: named, label: "C1's internal review Step" });
    // C1 reads it at the Step C1's shared Submit brought it to, K1's one lane: nothing of what K1 did inside.
    const arrival = (
      await migrator.query("select s.id from work_item w join workflow_step s on s.workflow_version_id = w.workflow_version_id and s.key = 'consultant_review' where w.id = $1", [withK1])
    ).rows[0].id as string;
    expect((await seen(c1Engineer)).find((r) => r.id === withK1)?.step_id).toBe(arrival);
  });

  it("Lanes: project_member_position gives each viewer their own Company's Positions only, so another Company is one lane", async () => {
    const positions = (as: string) => t.call<{ id: string }>(as, sql`select project_member_id as id from project_member_position where project_id = ${t.projectId}::uuid`);
    for (const who of [c1Pm, c1Engineer]) {
      await expectHiddenFrom({ read: positions, target: await projectMemberOf(who), seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1Engineer, k1Manager], name: named, label: `${named(who)}'s Position` });
    }
    await expectHiddenFrom({ read: positions, target: await projectMemberOf(k1Manager), seenBy: [k1Engineer, k1Manager], hiddenFrom: [c1Engineer, c1Pm], name: named, label: "K1's manager's Position" });
  });

  it("Created date: the Creation Date to C1 only; K1 reads the Submission Date, and nothing of how long C1 worked on it", async () => {
    const { numbered_at: numberedAt, submitted_at: submittedAt } = (await migrator.query("select numbered_at, submitted_at from work_item where id = $1", [withK1])).rows[0];
    await expectHiddenFrom({
      read: async (as: string) => (await seen(as)).filter((r) => r.creation_date !== null),
      target: withK1,
      seenBy: [c1Engineer, c1Pm],
      hiddenFrom: [k1Engineer, k1Manager],
      name: named,
      label: "the Creation Date",
    });
    expect((await seen(c1Engineer)).find((r) => r.id === withK1)).toMatchObject({ creation_date: numberedAt, submitted_at: submittedAt });
    expect((await seen(k1Engineer)).find((r) => r.id === withK1)).toMatchObject({ creation_date: null, submitted_at: submittedAt });
  });

  it("a closed card: the closing move is K1's to both, its person K1's alone to name (V14)", async () => {
    // The close is a shared move both read, by K1's Participant; C1 reads K1 by name through app.work_item_companies.
    const closer = async (as: string) =>
      (await t.call<{ actor_participant_id: string }>(as, sql`select actor_participant_id from work_item_event where work_item_id = ${closed}::uuid and type = 'issue_code'`)).map(
        (r) => r.actor_participant_id,
      );
    for (const as of [c1Engineer, k1Engineer]) expect(await closer(as), named(as)).toEqual([t.k1.participantId]);
    const companies = await t.call<{ participant_id: string; legal_name: unknown }>(c1Engineer, sql`select participant_id, legal_name from app.work_item_companies(${closed}::uuid)`);
    expect(companies.find((c) => c.participant_id === t.k1.participantId)?.legal_name).toEqual({ en: "K1", ar: "K1" });
    // Nobody holds a closed item, and the closer's own name is read through member, K1's people only.
    for (const as of [c1Engineer, k1Engineer]) expect((await seen(as)).find((r) => r.id === closed), named(as)).toMatchObject({ holder_member_id: null });
    await expectHiddenFrom({
      read: (as: string) => t.call<{ id: string }>(as, sql`select id from member where id = ${k1Manager}::uuid`),
      target: k1Manager,
      seenBy: k1Engineer,
      hiddenFrom: [c1Engineer, c1Pm],
      name: named,
      label: "who closed it",
    });
  });
});
