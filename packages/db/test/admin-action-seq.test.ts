// Seam 2 for admin_action.seq (RP-1117): the order Rabaed Engineers' actions were written in. Ids are random
// (ADR 0015) and `at` follows the database's clock, which can step back, so only seq is write order.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const tag = randomUUID().slice(0, 8);
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

let migrator: Db;
let admin: Db;
let app: Db;
let engineerId = "";
let memberId = "";

beforeAll(async () => {
  migrator = createDb(urls.migrator, { max: 1 });
  admin = createDb(urls.admin, { max: 1 });
  app = createDb(urls.app, { max: 1 });
  engineerId = (await sql<{ id: string }>`
    insert into rabaed_engineer (email, full_name) values (${`seq-${tag}@rabaed.test`}, 'Seq Test') returning id
  `.execute(migrator)).rows[0]!.id;
  const companyId = (await sql<{ id: string }>`
    insert into company (legal_name, cr_number, vat_number, onboarded_by)
    values ('{"en": "Seq Co", "ar": "Seq Co"}'::jsonb, ${digits(10)}, ${`3${digits(13)}3`}, ${engineerId}::uuid)
    returning id
  `.execute(migrator)).rows[0]!.id;
  memberId = (await sql<{ id: string }>`
    insert into member (company_id, email, full_name, status)
    values (${companyId}::uuid, ${`seq-member-${tag}@rabaed.test`}, '{"en": "M", "ar": "M"}'::jsonb, 'active')
    returning id
  `.execute(migrator)).rows[0]!.id;
});

afterAll(async () => {
  await Promise.all([migrator?.destroy(), admin?.destroy(), app?.destroy()]);
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
    const written = await admin
      .selectFrom("admin_action")
      .select("reason")
      .where("engineer_id", "=", engineerId)
      .orderBy("seq")
      .execute();
    expect(written.map((r) => r.reason)).toEqual(["first", "second", "third"]);
  });

  it("is given to each new row, larger than every row's before it", async () => {
    const { max } = await admin.selectFrom("admin_action").select((eb) => eb.fn.max("seq").as("max")).executeTakeFirstOrThrow();
    const { seq } = await record("next");
    expect(BigInt(seq)).toBeGreaterThan(BigInt(max ?? 0));
  });

  it("is never written by hand", async () => {
    await expect(
      sql`
        insert into admin_action (seq, engineer_id, action, target_kind, reason)
        values (1, ${engineerId}::uuid, 'read_numbering', 'seq-test', 'by hand')
      `.execute(admin),
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "seq"/);
  });

  it("stays out of the app role's reach, as the rest of admin_action does (V9)", async () => {
    await expect(withMember(app, memberId, (trx) => sql`select seq from admin_action`.execute(trx))).rejects.toThrow(/permission denied/);
  });
});
