// Seam 2 for the UAT tool's `uat:age` (RP-922, tests 3, 4, 5 and 8): an item moved back N weeks reads
// Step Age N to its holder, and every reader of Step Age follows it (app.step_as_seen); the Creation
// Date rules still hold; the audit trail is left exactly as it was. The tool runs as the migrator
// (packages/db/dev-tools), the reads as Members on the app role.
import { stepAgeWeeks } from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ageChanges, ageItems, AgeRefused, findAgeCandidates, ITEM_TIMES, runJob } from "../dev-tools/index.ts";
import { createDb, stepAgeReportHandler, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";
import { hiddenColumns } from "../../../scripts/hidden-columns.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tool: Db;
let tower: SeamTwoTower;
let serial = 0;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tool = createDb(urls.migrator, { max: 1 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RUA" });
});
afterAll(async () => {
  await migrator?.end();
  await app?.destroy();
  await tool?.destroy();
});

/** A WIR C1 Submitted, held by K1's Engineer; its id and Document Number. */
async function heldByK1(): Promise<{ id: string; number: string }> {
  const id = await wirAtConsultant(tower, { type: "WIR", title: `Aged pour ${++serial} ${Date.now()}` });
  const { rows } = await migrator.query<{ document_number: string }>("select document_number from work_item where id = $1", [id]);
  return { id, number: rows[0]!.document_number };
}

/** `uat:age --item <texts> --weeks <weeks>`, as the CLI runs it: candidates, the changes, then the write. */
async function age(texts: string[], weeks: number, { dryRun = false } = {}) {
  const changes = ageChanges({ items: texts, weeks }, await findAgeCandidates(tool, texts), new Date());
  if ("errors" in changes) throw new Error(changes.errors.join("; "));
  return ageItems(tool, changes.items, { dryRun });
}

/** When item `id`'s Step began, as Member `as` reads it (their Company's Step Age). */
async function enteredAsSeen(as: string, id: string): Promise<Date> {
  const [row] = await tower.call<{ entered_at: Date }>(as, sql`select entered_at from app.step_as_seen(${id}::uuid)`);
  return row!.entered_at;
}

describe("Step Age after uat:age", () => {
  it("its holder reads Step Age 4 after --weeks 4; another Company counts from when it reached K1, moved alike", async () => {
    const { id, number } = await heldByK1();
    const holderBefore = await enteredAsSeen(tower.k1.members.engineer, id);
    const raiserBefore = await enteredAsSeen(tower.c1.members.engineer, id);
    expect(stepAgeWeeks(holderBefore, new Date())).toBe(1);

    await age([number], 4);

    const holderAfter = await enteredAsSeen(tower.k1.members.engineer, id);
    expect(stepAgeWeeks(holderAfter, new Date())).toBe(4);
    const shift = holderBefore.getTime() - holderAfter.getTime();
    expect(shift).toBeGreaterThan(3 * 7 * 24 * 3_600_000);
    expect((await enteredAsSeen(tower.c1.members.engineer, id)).getTime()).toBe(raiserBefore.getTime() - shift);
  });
});

/** Every column the item has in the tables the tool writes, plus its events, as text: compared byte for byte. */
async function snapshot(id: string): Promise<{ events: string; item: string }> {
  const one = async (text: string) => (await migrator.query<{ t: string | null }>(text, [id])).rows[0]!.t ?? "";
  return {
    events: await one("select string_agg(to_jsonb(e)::text, E'\\n' order by e.id) as t from work_item_event e where e.work_item_id = $1"),
    item: await one("select to_jsonb(w)::text as t from work_item w where w.id = $1"),
  };
}

/** rabaed_app's SELECT on every hidden column (scripts/hidden-columns.ts), as one line each. */
async function hiddenPrivileges(): Promise<string[]> {
  const out: string[] = [];
  for (const { table, columns } of hiddenColumns) {
    for (const column of columns) {
      const { rows } = await migrator.query<{ ok: boolean }>("select has_column_privilege('rabaed_app', $1, $2, 'SELECT') as ok", [table, column]);
      out.push(`${table}.${column}: ${rows[0]!.ok}`);
    }
  }
  return out;
}

describe("what uat:age leaves alone", () => {
  it("--dry-run reports the rows it would change and writes nothing", async () => {
    const { id, number } = await heldByK1();
    const before = await snapshot(id);
    const [aged] = await age([number], 4, { dryRun: true });
    expect(aged!.rows).toMatchObject({ work_item: 1 });
    expect(aged!.rows.step_assignment).toBeGreaterThan(0);
    expect(await snapshot(id)).toEqual(before);
    expect(stepAgeWeeks(await enteredAsSeen(tower.k1.members.engineer, id), new Date())).toBe(1);
  });

  it("leaves the item's events byte for byte as they were, and its audit chain checks", async () => {
    const { id, number } = await heldByK1();
    const before = await snapshot(id);
    expect(before.events.length).toBeGreaterThan(0);
    await age([number], 6);
    const after = await snapshot(id);
    expect(after.events).toBe(before.events);
    expect(after.item).not.toBe(before.item);
    const { rows } = await migrator.query<{ intact: boolean }>("select app.work_item_chain_intact($1) as intact", [id]);
    expect(rows[0]!.intact).toBe(true);
  });

  it("keeps the shared answers and Document Number, and grants rabaed_app nothing", async () => {
    const { id, number } = await heldByK1();
    const read = async () =>
      (
        await migrator.query<{ document_number: string; data_as_arrived: unknown; arrivals: number; current_step_id: string }>(
          "select document_number, data_as_arrived, arrivals, current_step_id from work_item where id = $1",
          [id],
        )
      ).rows[0];
    const before = await read();
    const privileges = await hiddenPrivileges();
    await age([number], 3);
    expect(await read()).toEqual(before);
    expect(await hiddenPrivileges()).toEqual(privileges);
    // The hidden columns stay hidden from the app role.
    await expect(tower.call(tower.c1.members.engineer, sql<{ created_at: Date }>`select created_at from work_item where id = ${id}::uuid`)).rejects.toThrow(/permission denied/);
  });

  it("refuses an item the leaving triggers would change, and changes nothing", async () => {
    const { id, number } = await heldByK1();
    // A removed Link not yet sent: the item leaving would drop it (app.drop_removed_links_on_leaving).
    const { id: other } = await heldByK1();
    await migrator.query(
      "insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, removed_at) select project_id, $1, $2, 'related', created_by_member_id, now() from work_item where id = $1",
      [id, other],
    );
    const before = await snapshot(id);
    await expect(age([number], 4)).rejects.toThrow(AgeRefused);
    await expect(age([number], 4)).rejects.toThrow(/a removed Link not yet sent/);
    expect(await snapshot(id)).toEqual(before);
  });
});

describe("the weekly report after uat:age", () => {
  it("reads the item at Step Age 4", async () => {
    const { id, number } = await heldByK1();
    await age([number], 4);
    const { rows } = await migrator.query<{ email: string }>(
      `select m.email from project_member pm join member m on m.id = pm.member_id
       where pm.project_id = $1 and pm.status = 'active' and app.project_member_holds_assign(pm.id) order by m.email`,
      [tower.projectId],
    );
    const seen: number[] = [];
    const handler = stepAgeReportHandler(async (report) => {
      for (const i of report.items) if (i.workItemId === id) seen.push(i.stepAgeWeeks);
    });
    for (const { email } of rows) await runJob({ migrator: tool, worker: app }, "weekly-report", { handlers: { step_age_report: handler }, memberEmail: email, dryRun: false });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([4]));
  });
});

describe("the tool's list of item times (test 8)", () => {
  it("names every timestamp column of work_item and of every table with a foreign key to it, moved or kept", async () => {
    const { rows } = await migrator.query<{ table_name: string; column_name: string }>(`
      select c.table_name, c.column_name from information_schema.columns c
      where c.table_schema = 'public' and c.data_type like 'timestamp%'
        and (c.table_name = 'work_item' or c.table_name in (
          select distinct cl.relname from pg_constraint k join pg_class cl on cl.oid = k.conrelid
          where k.contype = 'f' and k.confrelid = 'public.work_item'::regclass))
      order by 1, 2`);
    const inDatabase = rows.map((r) => `${r.table_name}.${r.column_name}`);
    const listed = Object.entries(ITEM_TIMES)
      .flatMap(([table, t]) => [...t.moved, ...Object.keys(t.kept)].map((column) => `${table}.${column}`))
      .sort();
    expect(listed).toEqual([...inDatabase].sort());
  });
});
