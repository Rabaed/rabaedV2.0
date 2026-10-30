// Seam 2 for answer times and the Creation Date (RP-392; visibility.md "Creation Date", scenarios 61 and 75,
// scenarios RP-392-1 and RP-392-2), as the app role. app.work_item_field_times, the only read that hands out
// answer times, reads any time earlier than the item's own Creation Date (numbered_at) as that date once it
// is numbered, through Send Backs too, and a Revision is judged by its own. While it is a Draft the times are
// as stored. work_item.field_times keeps the stored times for audit, and the app role has no grant on it.
// The days are faked by moving the stored times back with the migrator. Seam 1 (the API's fieldTimes and
// "Saved <time>", the autosave after a Send Back): apps/api/test/send-back.test.ts, apps/api/test/revisions.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const DAY = 86_400_000;
// A test Type on the test Workflow (Send Backs to the Draft and to Contractor review, and Code C).
const TYPE = `RT${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const towerOptions = { projectCode: "RAT", k1Manager: true, checklistTemplate: false } as const;

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<typeof towerOptions>;
let engineer = "";
let pm = "";
let k1 = "";

type Times = Record<string, { at: string; by: string }> | null;
/** The answer times `as` reads of item `id`. */
const timesOf = async (as: string, id: string) =>
  (await t.call<{ times: Times }>(as, sql`select app.work_item_field_times(${id}::uuid) as times`))[0]!.times;
const atsOf = (times: Times) => Object.values(times ?? {}).map((v) => Date.parse(v.at));
const stored = async (id: string) => {
  const row = (await migrator.query("select field_times, numbered_at from work_item where id = $1", [id])).rows[0];
  return { ats: Object.values(row.field_times as Record<string, { at: string }>).map((v) => Date.parse(v.at)), numberedAt: row.numbered_at as Date | null };
};
/** Moves every stored answer time of `id` back by `days`: the answers were saved that long ago. */
const backDate = (id: string, days: number) =>
  migrator.query(
    `update work_item set field_times = (
       select jsonb_object_agg(f.key, jsonb_set(f.value, '{at}', to_jsonb((f.value ->> 'at')::timestamptz - make_interval(days => $2::int))))
       from jsonb_each(field_times) f)
     where id = $1`,
    [id, days],
  );

/** C1's engineer starts a Draft and saves its answers. */
async function draft(title: string): Promise<string> {
  const [created] = await t.call<{ outcome: string; work_item_id: string }>(
    engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${t.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
      ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await t.outcome(engineer, sql`select app.record_field_times(${id}::uuid, now()) as outcome`)).toBe("recorded");
  return id;
}

/** C1's PM picks the item up in Contractor review and Submits it; K1's engineer picks it up. */
async function toK1(id: string) {
  expect(await t.pickUp(pm, id)).toBe("picked_up");
  expect(await t.take(pm, id, "submit")).toBe("applied");
  const held = (await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [id])).rows[0];
  if (held?.assignee_member_id !== k1) expect(await t.pickUp(k1, id)).toBe("picked_up");
}

/** Every time `as` reads of `id` is at or after its Creation Date, and some stored one was earlier. */
async function expectFloored(as: string, id: string) {
  const { ats, numberedAt } = await stored(id);
  expect(numberedAt, "numbered").not.toBeNull();
  expect(Math.min(...ats), "a stored time earlier than the Creation Date").toBeLessThan(numberedAt!.getTime());
  const read = atsOf(await timesOf(as, id));
  expect(read.length, "times read").toBeGreaterThan(0);
  for (const at of read) expect(at).toBeGreaterThanOrEqual(numberedAt!.getTime());
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflow = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-392 times ${digits(6)}`) });
  const form = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Times (RP-392)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    form,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Times (RP-392)")), workflow, form],
  );
  t = await buildSeamTwoTower(app, migrator, towerOptions);
  engineer = t.c1.members.engineer;
  pm = t.c1.members.project_manager;
  k1 = t.k1.members.engineer;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-392-1: a Draft saved on day 1, numbered on day 3, later sent back", () => {
  it("gives co-editors the real times while it is still a Draft", async () => {
    const id = await draft("Still a Draft");
    await backDate(id, 2);
    const { ats, numberedAt } = await stored(id);
    expect(numberedAt).toBeNull();
    expect(atsOf(await timesOf(engineer, id)).sort()).toEqual([...ats].sort());
  });

  it("reads no time earlier than day 3 for C1's PM at Internal Review, and keeps the stored ones for audit", async () => {
    const id = await draft("Numbered on day 3");
    await backDate(id, 2);
    expect(await t.take(engineer, id, "send_for_review")).toBe("applied");
    await expectFloored(pm, id);
    await expectFloored(engineer, id);
  });

  it("reads none earlier for the engineer after a Send Back to the Draft", async () => {
    const id = await draft("Sent back to the Draft");
    await backDate(id, 2);
    expect(await t.take(engineer, id, "send_for_review")).toBe("applied");
    await toK1(id);
    expect(await t.take(k1, id, "send_back_to_draft")).toBe("applied");
    await expectFloored(engineer, id);
  });

  it("reads none earlier for the PM after a Send Back to Internal Review", async () => {
    const id = await draft("Sent back to review");
    await backDate(id, 2);
    expect(await t.take(engineer, id, "send_for_review")).toBe("applied");
    await toK1(id);
    expect(await t.take(k1, id, "send_back")).toBe("applied");
    await expectFloored(pm, id);
  });

  it("gives the app role no read of work_item.field_times, though the item is read", async () => {
    const id = await draft("Field times");
    expect(await t.call<{ id: string }>(engineer, sql`select id from work_item where id = ${id}::uuid`)).toEqual([{ id }]);
    await expect(t.call(engineer, sql<object>`select field_times from work_item where id = ${id}::uuid`)).rejects.toThrow(/permission denied/);
  });
});

describe("scenario RP-392-2: a Revision created on day 5 and sent for review on day 7", () => {
  it("reads no time earlier than the Revision's own Creation Date, whatever the original item's", async () => {
    const original = await draft("Revised");
    expect(await t.take(engineer, original, "send_for_review")).toBe("applied");
    await toK1(original);
    expect(await t.take(k1, original, "send_to_manager")).toBe("applied");
    const manager = t.k1.members.manager;
    const held = (await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [original])).rows[0];
    if (held?.assignee_member_id !== manager) expect(await t.pickUp(manager, original)).toBe("picked_up");
    expect(await t.take(manager, original, "revise_c")).toBe("applied");
    // The original was numbered six days before the Revision's review.
    await migrator.query("update work_item set numbered_at = numbered_at - interval '6 days' where id = $1", [original]);
    const [created] = await t.call<{ outcome: string; work_item_id: string }>(engineer, sql`select outcome, work_item_id from app.create_revision(${original}::uuid, ${randomUUID()}::uuid, now())`);
    expect(created!.outcome).toBe("created");
    const revision = created!.work_item_id;
    // Its answers were saved before even the original's Creation Date.
    await backDate(revision, 10);
    expect(await t.take(engineer, revision, "send_for_review")).toBe("applied");
    const own = (await stored(revision)).numberedAt!;
    const originals = (await stored(original)).numberedAt!;
    expect(own.getTime() - originals.getTime()).toBeGreaterThanOrEqual(6 * DAY - 60_000);
    await expectFloored(pm, revision);
    // Floored by the original's date the times would read 6 days early.
    for (const at of atsOf(await timesOf(pm, revision))) expect(at).toBeGreaterThan(originals.getTime());
  });
});
