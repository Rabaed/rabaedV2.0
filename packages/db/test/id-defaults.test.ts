// Seam 2: every table's ids are random UUIDv4 (RP-391; ADR 0015, visibility.md
// "Creation Date" and scenario 73). A UUIDv7 carries the millisecond it was made,
// so a Work Item's id told anyone who saw it when its Draft was started. This
// reads the live catalog after every migration, so a new table can't silently
// go back to a time-ordered id.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { idColumnsNotRandom } from "../test-support/id-defaults.ts";
import { rolledBack, testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

describe("ids (scenario 73)", () => {
  it("default to gen_random_uuid() in every table", async () => {
    expect(await idColumnsNotRandom(migrator)).toEqual([]);
  });

  it("can no longer be made as UUIDv7: the function is gone", async () => {
    const { rows } = await sql<{ fn: string | null }>`select to_regproc('app.uuid_v7')::text as fn`.execute(migrator);
    expect(rows[0]!.fn).toBeNull();
  });

  it("are caught when a new table's id carries a time, comes from a sequence or has no default", async () => {
    await rolledBack(migrator, async (trx) => {
      // A time-ordered uuid, as UUIDv7 was.
      await sql.raw("create table public.timed_probe (id uuid primary key default md5(clock_timestamp()::text)::uuid)").execute(trx);
      await sql.raw("create table public.sequence_probe (id bigint generated always as identity primary key)").execute(trx);
      await sql.raw("create table public.bare_probe (id uuid primary key)").execute(trx);
      await sql
        .raw("create table public.other_probe (id uuid primary key default gen_random_uuid(), ref uuid default md5(now()::text)::uuid)")
        .execute(trx);
      await sql.raw("create table public.random_probe (id uuid primary key default gen_random_uuid())").execute(trx);
      const found = await idColumnsNotRandom(trx);
      expect(found).toContain("public.timed_probe.id: (md5((clock_timestamp())::text))::uuid");
      expect(found).toContain("public.sequence_probe.id: no default");
      expect(found).toContain("public.bare_probe.id: no default");
      expect(found).toContain("public.other_probe.ref: (md5((now())::text))::uuid");
      expect(found.filter((f) => f.startsWith("public.random_probe.") || f.startsWith("public.other_probe.id"))).toEqual([]);
    });
  });
});
