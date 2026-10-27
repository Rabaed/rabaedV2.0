// Seam 1: Home and the Lists at the size of a real Project (RP-1050). System UAT round 0 loaded one
// Project of 858 work items and found Home at 18 s and the Lists at 3 to 4.4 s. Here one Project gets a
// few thousand items in every state a Member meets (Drafts, internal review, Submitted, picked up, coded,
// Snags open, in progress, resolved and closed), and each read must answer within READ_BOUND_MS.
//
// A few dozen items are made through the api, then the whole Project's items are copied in SQL, with
// every row the api wrote for them, so the copies are read like the originals at a cost of seconds. The
// copies are removed again afterwards, so the test files after this one find the database as before.
import { createDb, type Db } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { Home, WorkItemBoard, WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi } from "./support/harness.ts";
import { buildTower, detail, draft, inInternalReview, ok, submitted, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
// The superuser, on the test database (its URL names `postgres`): only it may turn the triggers off for the copy.
const urls = testDatabaseUrls();
const superuserUrl = new URL(urls.superuser);
superuserUrl.pathname = new URL(urls.migrator).pathname;
const superuser = createDb(superuserUrl.toString(), { max: 1 });
afterAll(async () => {
  await api.close();
  if (copied) await removeCopies(superuser, copied);
  await superuser.destroy();
});

/** The copies' ids, once made. */
let copied: string[] | undefined;

/**
 * How many copies of the Project's api-made items: 41 items each time, so 2,500 items in all. RABAED_SCALE_COPIES
 * measures another size locally (20 is round 0's 858 items).
 */
const COPIES = Number(process.env.RABAED_SCALE_COPIES ?? 60);

/**
 * The most each read may take, the fastest of three. On a lane, at 2,500 items, Home and the Lists answer in 0.2 to
 * 0.8 s and the Kanban in about 1.3 s, where the Transitions of each of the 244 cards its viewer picked up cost most;
 * before RP-1050 they took 6 to 19 s at 858 items. The bound leaves room for a slower CI runner and still fails at once
 * if a read goes back to checking each item many times over.
 */
const READ_BOUND_MS = 3000;

/**
 * Copies every work item of `projectId` `copies` times, as the superuser with the triggers off: each copy
 * keeps its original's state, history, holders, access, Trade and Location, watches and links, under new
 * ids, Subjects and Document Numbers. With the triggers off nothing is numbered, notified or chained again:
 * the rows are what the api wrote. Notifications and Documents are not copied. Gives the copies' ids.
 */
async function copyProject(db: Db, projectId: string, copies: number): Promise<string[]> {
  return db.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`
      create temp table item_copy on commit drop as
      select w.id as old_id, gen_random_uuid() as new_id, g.k
      from work_item w cross join generate_series(1, ${copies}::int) g (k)
      where w.project_id = ${projectId}::uuid
    `.execute(trx);
    await sql`create unique index on item_copy (old_id, k)`.execute(trx);
    const copyOf = (column: string) => sql`(select c2.new_id from item_copy c2 where c2.old_id = w.${sql.ref(column)} and c2.k = c.k)`;
    await sql`
      insert into work_item
      select (jsonb_populate_record(null::work_item, to_jsonb(w) || jsonb_build_object(
        'id', c.new_id, 'title', w.title || ' #' || c.k,
        'document_number', case when w.document_number is null then null else w.document_number || '-' || c.k end,
        'root_id', ${copyOf("root_id")}, 'revision_of_id', ${copyOf("revision_of_id")}, 'duplicated_from_id', ${copyOf("duplicated_from_id")},
        'paper_ref', null, 'duplicate_key', null, 'duplicate_member_id', null))).*
      from work_item w join item_copy c on c.old_id = w.id
    `.execute(trx);
    // Its search_tsv is generated from search_text.
    await sql`
      insert into work_item_search (work_item_id, project_id, search_text)
      select c.new_id, t.project_id, t.search_text from work_item_search t join item_copy c on c.old_id = t.work_item_id
    `.execute(trx);
    for (const table of ["work_item_access", "work_item_dimension_value", "work_item_scope"]) {
      await sql`
        insert into ${sql.table(table)}
        select (jsonb_populate_record(null::${sql.table(table)}, to_jsonb(t) || jsonb_build_object('work_item_id', c.new_id))).*
        from ${sql.table(table)} t join item_copy c on c.old_id = t.work_item_id
      `.execute(trx);
    }
    await sql`
      insert into step_assignment
      select (jsonb_populate_record(null::step_assignment, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'work_item_id', c.new_id))).*
      from step_assignment t join item_copy c on c.old_id = t.work_item_id
    `.execute(trx);
    await sql`
      create temp table event_copy on commit drop as
      select e.id as old_id, gen_random_uuid() as new_id, c.new_id as work_item_id
      from work_item_event e join item_copy c on c.old_id = e.work_item_id
    `.execute(trx);
    await sql`
      insert into work_item_event
      select (jsonb_populate_record(null::work_item_event, to_jsonb(e) || jsonb_build_object('id', x.new_id, 'work_item_id', x.work_item_id))).*
      from work_item_event e join event_copy x on x.old_id = e.id
    `.execute(trx);
    await sql`
      insert into work_item_event_signer
      select (jsonb_populate_record(null::work_item_event_signer, to_jsonb(s) || jsonb_build_object('event_id', x.new_id))).*
      from work_item_event_signer s join event_copy x on x.old_id = s.event_id
    `.execute(trx);
    await sql`
      insert into work_item_watch
      select (jsonb_populate_record(null::work_item_watch, to_jsonb(t) || jsonb_build_object('root_id', c.new_id))).*
      from work_item_watch t join item_copy c on c.old_id = t.root_id
    `.execute(trx);
    await sql`
      insert into work_item_link
      select (jsonb_populate_record(null::work_item_link, to_jsonb(l) || jsonb_build_object(
        'id', gen_random_uuid(), 'from_id', f.new_id, 'to_id', coalesce(t.new_id, l.to_id)))).*
      from work_item_link l join item_copy f on f.old_id = l.from_id left join item_copy t on t.old_id = l.to_id and t.k = f.k
    `.execute(trx);
    const { rows } = await sql<{ id: string }>`select new_id as id from item_copy`.execute(trx);
    return rows.map((r) => r.id);
  });
}

/** Removes the copies `ids` and every row copied with them, as copyProject made them (the triggers off: events are append-only). */
async function removeCopies(db: Db, ids: readonly string[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    const copies = sql`(select unnest(${ids}::uuid[]))`;
    await sql`delete from work_item_event_signer where event_id in (select id from work_item_event where work_item_id in ${copies})`.execute(trx);
    await sql`delete from work_item_link where from_id in ${copies} or to_id in ${copies}`.execute(trx);
    await sql`delete from work_item_watch where root_id in ${copies}`.execute(trx);
    for (const table of ["work_item_event", "step_assignment", "work_item_access", "work_item_dimension_value", "work_item_scope", "work_item_search"]) {
      await sql`delete from ${sql.table(table)} where work_item_id in ${copies}`.execute(trx);
    }
    await sql`delete from work_item where id in ${copies}`.execute(trx);
  });
}

let at: Tower;

/** C1's PM moves Snag `id` by `transition`, and picks it up where it lands in C1's Step Pool. */
async function move(id: string, transition: string) {
  await take(at.c1Pm, id, transition);
  if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
}

/** A Snag K1's manager raised on C1, Open in C1's Step Pool. */
async function snag(title: string): Promise<string> {
  const res = await ok(
    at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "SNG",
      title,
      answers: { description: title, trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(at.k1Manager, id, "raise");
  return id;
}

/** A MAR at K1, picked up by its manager. */
async function atK1(title: string): Promise<string> {
  const id = await submitted(at, at.c1Engineer, at.c1Pm, title);
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SCL");
  for (let i = 0; i < 4; i++) {
    await draft(at, at.c1Engineer, `Draft cable ${i}`);
    await inInternalReview(at, at.c1Engineer, `Reviewed cable ${i}`);
    await submitted(at, at.c1Engineer, at.c1Pm, `Submitted tray ${i}`, i % 2 === 0 ? at.electrical : at.mechanical);
    await atK1(`Picked up duct ${i}`);
    await take(at.k1Manager, await atK1(`Approved panel ${i}`), "approve_a");
    await take(at.k1Manager, await atK1(`Revise pump ${i}`), "revise_c", { remarks: "Resubmit" });

    await snag(`Open snag ${i}`);
    const inProgress = await snag(`Working snag ${i}`);
    await ok(at.c1Pm.post(`/v1/work-items/${inProgress}/pick-up`));
    await move(inProgress, "start_work");
    const resolved = await snag(`Resolved snag ${i}`);
    await ok(at.c1Pm.post(`/v1/work-items/${resolved}/pick-up`));
    await take(at.c1Pm, resolved, "resolve", { answers: { resolution_note: "Done" } });
    if (i % 2 === 0) await take(at.k1Manager, resolved, "close");
  }
  copied = await copyProject(superuser, at.projectId, COPIES);
  await sql`analyze`.execute(superuser);
});

/** The fastest of `runs` calls of `read`, in milliseconds: the first warms the plan cache and the pool. */
async function fastest(read: () => Promise<unknown>, runs = 3): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await read();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe(`one Project of a few thousand work items (RP-1050)`, () => {
  it("has the items it says", async () => {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from work_item where project_id = ${at.projectId}::uuid`.execute(superuser);
    expect(rows[0]!.n).toBeGreaterThan(30 * (COPIES + 1));
  });

  for (const [who, caller] of [
    ["C1's PM", () => at.c1Pm],
    ["K1's manager", () => at.k1Manager],
  ] as const) {
    it(`answers Home, the Submittals List and Kanban and the Snag List for ${who} in under ${READ_BOUND_MS / 1000} s`, async () => {
      const by = caller();
      const base = `/v1/projects/${at.projectId}/modules`;
      const times = {
        home: await fastest(async () => (await ok(by.get("/v1/home"), 200)).json() as Home),
        submittals: await fastest(async () => (await ok(by.get(`${base}/submittals/work-items`), 200)).json() as WorkItemList),
        kanban: await fastest(async () => (await ok(by.get(`${base}/submittals/work-items/kanban`), 200)).json() as WorkItemBoard),
        snags: await fastest(async () => (await ok(by.get(`${base}/snag_list/work-items`), 200)).json() as WorkItemList),
      };
      console.log(`RP-1050 reads, ${who}, ms:`, JSON.stringify(times));
      for (const ms of Object.values(times)) expect(ms).toBeLessThan(READ_BOUND_MS);
    });
  }

  it("still shows K1 only what it sees: the Submitted items, never C1's Drafts or internal review", async () => {
    const list: WorkItemList = (await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/modules/submittals/work-items`), 200)).json();
    // Per copy: 4 Submitted, 4 picked up, 4 approved, 4 to revise.
    expect(list.stages.reduce((n, s) => n + s.count, 0)).toBe(16 * (COPIES + 1));
    const board = (await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/modules/submittals/work-items/kanban`), 200)).body;
    for (const hidden of ["Draft cable", "Reviewed cable"]) expect(board).not.toContain(hidden);
  });
});
