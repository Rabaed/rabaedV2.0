// Seam 2 for admin_action.seq (RP-1117): the order Rabaed Engineers' actions were written in. Ids are random
// (ADR 0015) and `at` follows the database's clock, which can step back, so only seq is write order.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let admin: Db;
let app: Db;
let tower: SeamTwoTower;
let engineerId = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  admin = createDb(urls.admin, { max: 1 });
  app = createDb(urls.app, { max: 1 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "SEQ" });
  // An Engineer of this test's own, so its rows are the only ones it reads.
  engineerId = (
    await migrator.query<{ id: string }>("insert into rabaed_engineer (email, full_name) values ($1, 'Seq Test') returning id", [
      `seq-${randomUUID().slice(0, 8)}@rabaed.test`,
    ])
  ).rows[0]!.id;
});

afterAll(async () => {
  await Promise.all([admin?.destroy(), app?.destroy()]);
  await migrator?.end();
});

/** An action recorded as the admin role, at `at` (the database's now() when not given). */
const record = async (reason: string, at: string | null = null) =>
  (
    await sql<{ seq: string }>`
      insert into admin_action (engineer_id, action, target_kind, reason, at)
      values (${engineerId}::uuid, 'read_numbering', 'seq-test', ${reason}, coalesce(${at}::timestamptz, now()))
      returning seq
    `.execute(admin)
  ).rows[0]!;

describe("admin_action.seq", () => {
  it("numbers rows in the order they were written, even when the clock stepped back", async () => {
    await record("first", "2030-01-02T00:00:00Z");
    await record("second", "2030-01-01T00:00:00Z");
    await record("third", "2030-01-01T00:00:00Z");
    const written = await admin.selectFrom("admin_action").select("reason").where("engineer_id", "=", engineerId).orderBy("seq").execute();
    expect(written.map((r) => r.reason)).toEqual(["first", "second", "third"]);
  });

  it("is given to each new row, larger than every row's before it", async () => {
    const { max } = await admin.selectFrom("admin_action").select((eb) => eb.fn.max("seq").as("max")).executeTakeFirstOrThrow();
    const { seq } = await record("next");
    expect(BigInt(seq)).toBeGreaterThan(BigInt(max ?? 0));
  });

  it("is never written by hand, and never twice even when an insert overrides the identity", async () => {
    const { seq } = await record("taken");
    await expect(
      sql`
        insert into admin_action (seq, engineer_id, action, target_kind, reason)
        values (${seq}::bigint + 1000000, ${engineerId}::uuid, 'read_numbering', 'seq-test', 'by hand')
      `.execute(admin),
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "seq"/);
    await expect(
      sql`
        insert into admin_action (seq, engineer_id, action, target_kind, reason) overriding system value
        values (${seq}::bigint, ${engineerId}::uuid, 'read_numbering', 'seq-test', 'a repeat')
      `.execute(admin),
    ).rejects.toThrow(/admin_action_seq_key/);
  });

  it("stays out of the app role's reach, as the rest of admin_action does (V9), while the Member still reads its own Company", async () => {
    const member = tower.c1.members.engineer;
    expect(await tower.call<{ id: string }>(member, sql`select id from company`)).toContainEqual({ id: tower.c1.id });
    await expect(tower.call(member, sql<{ seq: string }>`select seq from admin_action`)).rejects.toThrow(/permission denied/);
  });
});
