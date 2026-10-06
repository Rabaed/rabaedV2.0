// Seam 2 for Watch (RP-354, spec RP-344; visibility.md the Watch row and
// scenario 67), as the app role: a Member reads only their own Watch rows, never
// a chain's id, and can't write any row directly, so nobody can list or count
// who else watches an item. Watching goes through app.watch_work_item, which
// refuses an item the caller doesn't see like a made-up one. "Who watches this
// item" (app.work_item_watchers) is for delivery only: the app role can't run it,
// and it names only the watchers who still see the item.
import { randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Side = { creator: string; projectId: string; participantId: string; item: string; mechanical: string };
let a: Side;
let b: Side;

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string, query: RawBuilder<unknown>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company whose Authorized Person creates a Project and raises one MAR on it, as the app role. */
async function side(engineer: string, name: string, code: string): Promise<Side> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const creator = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [companyId, email("creator"), JSON.stringify({ en: name, ar: name })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [creator, companyId]);
  const [project] = await rowsAs<{ project_id: string }>(
    creator,
    sql`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = project!.project_id;
  const participantId = await one("select id from participant where project_id = $1", [projectId]);
  const value = async (kind: string, valueCode: string) =>
    (
      await rowsAs<{ value_id: string }>(
        creator,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, '{"en": "V", "ar": "ق"}'::jsonb)`,
      )
    )[0]!.value_id;
  const electrical = await value("trade", "EL");
  const mechanical = await value("trade", "ME");
  const location = await value("location", "BA");
  for (const [kind, ids] of [
    ["trade", [electrical, mechanical]],
    ["location", [location]],
  ] as const) {
    await rowsAs(creator, sql`select app.set_participant_visibility(${participantId}::uuid, ${kind}, false, ${ids}::uuid[], now())`);
    await rowsAs(creator, sql`select app.set_member_visibility(${participantId}::uuid, ${creator}::uuid, ${kind}, false, ${ids}::uuid[], now())`);
  }
  await rowsAs(creator, sql`select app.set_project_member_positions(${participantId}::uuid, ${creator}::uuid, ${["engineer"]}::text[])`);
  const [created] = await rowsAs<{ outcome: string; work_item_id: string }>(
    creator,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
      ${electrical}::uuid, ${location}::uuid, now(), '{}'::uuid[])`,
  );
  expect(created!.outcome).toBe("created");
  return { creator, projectId, participantId, item: created!.work_item_id, mechanical };
}

/** All watch rows of `item`'s chain, as the migrator sees them. */
const watchersOf = async (item: string) =>
  (
    await migrator.query<{ member_id: string }>(
      "select ww.member_id from work_item_watch ww join work_item w on w.root_id = ww.root_id where w.id = $1 order by 1",
      [item],
    )
  ).rows.map((r) => r.member_id);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "Company A", "WTA");
  b = await side(engineer, "Company B", "WTB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("work_item_watch, as the app role", () => {
  it("has the raiser watching the item they raised", async () => {
    expect(await watchersOf(a.item)).toEqual([a.creator]);
    expect(await watchersOf(b.item)).toEqual([b.creator]);
  });

  it("shows a Member only their own rows, so a count is only ever their own", async () => {
    const all = sql<{ member_id: string; project_id: string }>`select member_id, project_id from work_item_watch`;
    expect(await rowsAs(a.creator, all)).toEqual([{ member_id: a.creator, project_id: a.projectId }]);
    expect(await rowsAs(b.creator, all)).toEqual([{ member_id: b.creator, project_id: b.projectId }]);
    expect(await rowsAs(a.creator, sql`select count(*)::int as n from work_item_watch`)).toEqual([{ n: 1 }]);
    const none = await app.transaction().execute((trx) => all.execute(trx));
    expect(none.rows).toEqual([]);
  });

  it("never gives the chain's id, nor lets a Member write a row directly", async () => {
    await expect(rowsAs(a.creator, sql`select root_id from work_item_watch`)).rejects.toThrow(/permission denied/);
    await expect(
      rowsAs(a.creator, sql`insert into work_item_watch (member_id, project_id, root_id) values (${a.creator}::uuid, ${b.projectId}::uuid, ${b.item}::uuid)`),
    ).rejects.toThrow(/permission denied/);
    await expect(rowsAs(a.creator, sql`delete from work_item_watch`)).rejects.toThrow(/permission denied/);
    await expect(rowsAs(a.creator, sql`update work_item_watch set created_at = now()`)).rejects.toThrow(/permission denied/);
    expect(await watchersOf(b.item)).toEqual([b.creator]);
  });

  it("refuses to watch, unwatch or read the Watch of an item the caller doesn't see, like a made-up id", async () => {
    for (const item of [b.item, randomUUID()]) {
      expect(await rowsAs(a.creator, sql`select app.watch_work_item(${item}::uuid) as outcome`)).toEqual([{ outcome: "not_found" }]);
      expect(await rowsAs(a.creator, sql`select app.unwatch_work_item(${item}::uuid) as outcome`)).toEqual([{ outcome: "not_found" }]);
      expect(await rowsAs(a.creator, sql`select app.watching_work_item(${item}::uuid) as watching`)).toEqual([{ watching: null }]);
    }
    expect(await watchersOf(b.item)).toEqual([b.creator]);
  });
});

describe("app.work_item_watchers, for delivery", () => {
  it("is never run by the app role, with a Member set or without", async () => {
    await expect(rowsAs(a.creator, sql`select * from app.work_item_watchers(${a.item}::uuid)`)).rejects.toThrow(/permission denied/);
    await expect(
      app.transaction().execute((trx) => sql`select * from app.work_item_watchers(${a.item}::uuid)`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("names the watchers who still see the item, and leaves out one who lost sight of it", async () => {
    const watchers = async () =>
      (await migrator.query<{ member_id: string }>("select member_id from app.work_item_watchers($1)", [a.item])).rows.map((r) => r.member_id);
    expect(await watchers()).toEqual([a.creator]);
    // Narrowed off the item's Trade: still a row, but no longer a watcher delivery may reach.
    await rowsAs(a.creator, sql`select app.set_member_visibility(${a.participantId}::uuid, ${a.creator}::uuid, 'trade', false, ${[a.mechanical]}::uuid[], now())`);
    expect(await watchersOf(a.item)).toEqual([a.creator]);
    expect(await watchers()).toEqual([]);
    // It leaves the session's Member as it found it.
    const { rows } = await migrator.query<{ member: string | null }>("select current_setting('app.member_id', true) as member");
    expect(rows[0]!.member ?? "").toBe("");
  });
});
