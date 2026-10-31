// Seam 2: a Rabaed Engineer reassigns a stuck Step in Rabaed Admin (RP-1162, UAT ADM-10;
// workflow-engine.md §5.6, ADR 0018). K1 raises a Snag that C1 holds; C1's PM has picked it up
// and is away. The Engineer, on the admin connection, finds it by Project and Document Number,
// hands it to C1's engineer, then back to C1's pool. Only C1's Members read it, as an internal
// `admin_reassigned` event that names no Engineer; K1 and C2 read nothing new (V5, V14). The
// Engineer can never hand it to another Company's Member, and never takes a Transition.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, drainOutbox, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
let adminDb: Db;
let tower: SeamTwoTower;
let call: SeamTwoTower["call"];
let engineerId = "";
let c1Pm = "";
let c1Engineer = "";
let k1 = "";
let c2 = "";
let snag = "";
let documentNumber = "";

const whoIs = (as: string) => ({ [c1Pm]: "C1 PM", [c1Engineer]: "C1 engineer", [k1]: "K1 engineer", [c2]: "C2 engineer" })[as] ?? `Member ${as}`;

type Found = {
  work_item_id: string;
  document_number: string;
  title: string;
  closed: boolean;
  draft_step: boolean;
  step_name: { en: string } | null;
  assignment_status: string | null;
  participant_id: string | null;
  company_name: { en: string } | null;
  holder_member_id: string | null;
  pool: { member_id: string; name: { en: string }; email: string }[];
};
/** What the Engineer reads of the item numbered `number` on the Tower's Project. */
const find = async (number: string) =>
  (await sql<Found>`select * from app.work_item_step_for_engineer(${tower.projectId}::uuid, ${number})`.execute(adminDb)).rows;
/** The Engineer hands the item's Step to `to`, or back to the pool when `to` is null. */
const reassign = async (to: string | null) =>
  (
    await sql<{ result: string; from_member_id: string | null; to_member_id: string | null }>`
      select * from app.reassign_step_by_engineer(${snag}::uuid, ${to}::uuid, ${engineerId}::uuid, ${randomUUID()}::uuid, now())
    `.execute(adminDb)
  ).rows[0]!;
const holder = async () => (await migrator.query("select status, assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [snag])).rows;
const events = (as: string) =>
  call<{ id: string; type: string; audience: string; actor_participant_id: string | null }>(
    as,
    sql`select id, type, audience, actor_participant_id from work_item_event where work_item_id = ${snag}::uuid order by seq`,
  );
const history = (as: string) =>
  call<{ type: string; company_name: unknown; member_name: unknown; handover: { from: { en: string } | null; to: { en: string } | null } | null }>(
    as,
    sql`select type, company_name, member_name, handover from app.work_item_history(${snag}::uuid)`,
  );
const stepAsSeen = (as: string) => call<{ step_id: string; stage_key: string; entered_at: Date }>(as, sql`select step_id, stage_key, entered_at from app.step_as_seen(${snag}::uuid)`);
const notifications = (as: string) =>
  call<{ id: string; kind: string }>(as, sql`select id, kind from notification where work_item_id = ${snag}::uuid and member_id = app.current_member_id()`);
/** Every read K1 and C2 make of the Snag that a reassign could change. */
const othersRead = async (as: string) => ({
  events: await events(as),
  history: await history(as),
  step: await stepAsSeen(as),
  holder: await call(as, sql<{ participant_id: string }>`select * from app.work_item_holder(${snag}::uuid)`),
  notifications: await notifications(as),
});

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  adminDb = createDb(urls.admin, { max: 1 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RRA" });
  call = tower.call;
  c1Pm = tower.c1.members.project_manager;
  c1Engineer = tower.c1.members.engineer;
  k1 = tower.k1.members.engineer;
  c2 = tower.c2.members.engineer;
  engineerId = (await migrator.query("insert into rabaed_engineer (email, full_name) values ($1, 'Nora Engineer') returning id", [`nora-${randomUUID().slice(0, 8)}@rabaed.test`]))
    .rows[0].id;
  // K1 raises a Snag on C1, whose PM picks it up (C1's pool holds its PM and engineer).
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    k1,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'SNG', 'Cable tray not bonded', app.latest_form_version('SNG'), '{"description": "Cable tray not bonded"}'::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  snag = created!.work_item_id;
  expect(await tower.take(k1, snag, "raise")).toBe("applied");
  expect(await tower.pickUp(c1Pm, snag)).toBe("picked_up");
  documentNumber = (await migrator.query("select document_number from work_item where id = $1", [snag])).rows[0].document_number;
  await drainOutbox(app);
});

afterAll(async () => {
  await app?.destroy();
  await adminDb?.destroy();
  await migrator?.end();
});

describe("the Engineer's read of a stuck Step (RP-1162)", () => {
  it("finds the item by its Project and Document Number, with its Step, holding Company, holder and pool", async () => {
    const [found] = await find(documentNumber);
    expect(found).toMatchObject({
      work_item_id: snag,
      title: "Cable tray not bonded",
      closed: false,
      draft_step: false,
      assignment_status: "picked_up",
      participant_id: tower.c1.participantId,
      holder_member_id: c1Pm,
    });
    expect(found!.company_name?.en).toBe("C1");
    expect(found!.step_name).not.toBeNull();
    // The pool is the holding Participant's own: C1's Members only.
    expect(found!.pool.map((m) => m.member_id).sort()).toEqual([c1Engineer, c1Pm].sort());
  });

  it("finds nothing for a number on another Project, or one nobody issued", async () => {
    expect(await find("NOT-A-NUMBER")).toEqual([]);
    const other = await sql<Found>`select * from app.work_item_step_for_engineer(${randomUUID()}::uuid, ${documentNumber})`.execute(adminDb);
    expect(other.rows).toEqual([]);
  });

  it("is refused to the app role: only Rabaed Admin reads or reassigns through these", async () => {
    await expect(call(c1Pm, sql<{ work_item_id: string }>`select * from app.work_item_step_for_engineer(${tower.projectId}::uuid, ${documentNumber})`)).rejects.toThrow(/permission denied/);
    await expect(
      call(c1Pm, sql<{ result: string }>`select * from app.reassign_step_by_engineer(${snag}::uuid, ${c1Engineer}::uuid, ${engineerId}::uuid, ${randomUUID()}::uuid, now())`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("RP-1162-2: the Engineer never hands a Step to another Company", () => {
  it("RP-1162-2: K1's and C2's Members, a made-up id and the holder themself are not_offered, and nothing changes", async () => {
    const before = await holder();
    const eventsBefore = await events(c1Pm);
    for (const to of [k1, c2, tower.k1.ap, randomUUID(), c1Pm]) expect((await reassign(to)).result, whoIs(to)).toBe("not_offered");
    expect(await holder()).toEqual(before);
    expect(await events(c1Pm)).toEqual(eventsBefore);
  });
});

describe("RP-1162-1: a reassign by Rabaed is C1's own, and names no Engineer", () => {
  let k1Before: Awaited<ReturnType<typeof othersRead>>;
  let c2Before: Awaited<ReturnType<typeof othersRead>>;
  let c1StepBefore: Awaited<ReturnType<typeof stepAsSeen>>;

  beforeAll(async () => {
    k1Before = await othersRead(k1);
    c2Before = await othersRead(c2);
    c1StepBefore = await stepAsSeen(c1Pm);
    expect(await reassign(c1Engineer)).toEqual({ result: "reassigned", from_member_id: c1Pm, to_member_id: c1Engineer });
    await drainOutbox(app);
  });

  it("RP-1162-1: C1's engineer holds it and gets Step reached; C1's PM's unread one is withdrawn", async () => {
    expect(await holder()).toEqual([{ status: "picked_up", assignee_member_id: c1Engineer }]);
    expect((await notifications(c1Engineer)).map((n) => n.kind)).toContain("step_reached");
    expect((await notifications(c1Pm)).filter((n) => n.kind === "step_reached")).toEqual([]);
  });

  it("RP-1162-1: C1's history reads it as Rabaed's, from the PM to the engineer, with no Member and no Company named", async () => {
    const reassigned = (await history(c1Pm)).filter((e) => e.type === "admin_reassigned");
    expect(reassigned).toEqual([{ type: "admin_reassigned", company_name: null, member_name: null, handover: expect.objectContaining({ from: expect.objectContaining({ en: "project_manager" }), to: expect.objectContaining({ en: "engineer" }) }) }]);
    expect((await events(c1Pm)).filter((e) => e.type === "admin_reassigned")).toEqual([
      expect.objectContaining({ audience: "internal", actor_participant_id: null }),
    ]);
  });

  it("RP-1162-1: the event is hidden from K1 and C2, and their every read of the item is as it was", async () => {
    const reassignedEvent = async (as: string) => (await events(as)).filter((e) => e.type === "admin_reassigned");
    const [event] = await reassignedEvent(c1Pm);
    await expectHiddenFrom({ read: reassignedEvent, target: event!.id, seenBy: [c1Pm, c1Engineer], hiddenFrom: [k1, c2], name: whoIs, label: "the Engineer's reassign" });
    expect(await othersRead(k1)).toEqual(k1Before);
    expect(await othersRead(c2)).toEqual(c2Before);
    // Positive control: K1 reads the item and its shared history.
    expect(k1Before.events.length).toBeGreaterThan(0);
  });

  it("RP-1162-1: no Member reads which Engineer it was", async () => {
    await expect(call(c1Pm, sql<{ actor_engineer_id: string }>`select actor_engineer_id from work_item_event where work_item_id = ${snag}::uuid`)).rejects.toThrow(/permission denied/);
    // The event names the Engineer for Rabaed's own audit.
    const { rows } = await migrator.query("select actor_engineer_id from work_item_event where work_item_id = $1 and type = 'admin_reassigned'", [snag]);
    expect(rows).toEqual([{ actor_engineer_id: engineerId }]);
  });

  it("RP-1162-1: back to C1's pool, the Step waits on C1's Members again and K1 and C2 still read nothing new", async () => {
    expect(await reassign(null)).toEqual({ result: "returned_to_pool", from_member_id: c1Engineer, to_member_id: null });
    expect(await holder()).toEqual([{ status: "pooled", assignee_member_id: null }]);
    expect((await reassign(null)).result).toBe("already_pooled");
    const handovers = (await history(c1Pm)).filter((e) => e.type === "admin_reassigned").map((e) => [e.handover?.from?.en ?? null, e.handover?.to?.en ?? null]);
    expect(handovers).toEqual([
      ["project_manager", "engineer"],
      ["engineer", null],
    ]);
    await drainOutbox(app);
    expect(await othersRead(k1)).toEqual(k1Before);
    expect(await othersRead(c2)).toEqual(c2Before);
  });

  it("never takes a Transition: the item stays at its Step, Stage and Step Age", async () => {
    const types = (await migrator.query("select type from work_item_event where work_item_id = $1 and actor_engineer_id is not null", [snag])).rows.map((r) => r.type);
    expect(types).toEqual(["admin_reassigned", "admin_reassigned"]);
    expect(await stepAsSeen(c1Pm)).toEqual(c1StepBefore);
    expect(c1StepBefore).toHaveLength(1);
  });
});
