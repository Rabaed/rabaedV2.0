// Seam 2 for the demo's sample Project (RP-1217; visibility.md V1, V2, V3, V5 and scenarios RP-1217-1 to
// RP-1217-5), as the app role. The seam suites' global setup seeds it with the demo (Al Nakheel District –
// Block A, NKD); this suite reads its rows as the demo people through the reads the api stands on (the
// project, work_item and work_item_event tables' RLS, app.work_items_seen), each hidden row first read by
// someone who may see it. Seam 1: apps/api/test/sample-project.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;

const EMAILS = {
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
} as const;
type Who = keyof typeof EMAILS;
const id = {} as Record<Who, string>;
const who = new Map<string, string>();
const named = (memberId: string) => who.get(memberId) ?? memberId;
let projectId = "";

const rowsAs = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
/** The Submittals List as `as` reads it (app.work_items_seen, the api's List): each chain's latest item. */
const submittals = (as: string) => rowsAs<{ id: string }>(as, sql`select w.id from app.work_items_seen(${projectId}::uuid, array['submittals']::text[], false, null) w`);
/** The Snag List the same way. */
const snagList = (as: string) => rowsAs<{ id: string }>(as, sql`select w.id from app.work_items_seen(${projectId}::uuid, array['snag_list']::text[], false, null) w`);
/** Item `item` by id: one row when `as` may see it. */
const workItem = (item: string) => (as: string) => rowsAs<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`);
/** The sample Project by id: one row when `as` is on it. */
const project = (as: string) => rowsAs<{ id: string }>(as, sql`select id from project where id = ${projectId}::uuid`);

/** The sample Project's items the migrator reads, by `where` on work_item `w` (its Stage, Type, Trade). */
async function items(where: string): Promise<string[]> {
  const { rows } = await migrator.query(
    // The Trade's code (the sample Project's Location codes are never a Trade's).
    `select w.id from work_item w join work_item_type t on t.id = w.work_item_type_id
       left join lateral (select v.code from work_item_dimension_value wd join dimension_value v on v.id = wd.dimension_value_id
                          where wd.work_item_id = w.id and v.code in ('EL', 'ME', 'CV', 'GEN')) d on true
     where w.project_id = $1 and ${where} order by w.id`,
    [projectId],
  );
  return rows.map((r) => r.id as string);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  for (const [key, email] of Object.entries(EMAILS) as [Who, string][]) {
    id[key] = (await migrator.query("select id from member where email = $1", [email])).rows[0].id;
    who.set(id[key], key);
  }
  projectId = (await migrator.query("select id from project where code = 'NKD'")).rows[0].id;
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("the sample Project, as the app role (seam 2)", () => {
  it("RP-1217-1: the Consultant reads every Submitted Submittal; it and the Owner Representative read none of the 12 in the Contractor's Internal Review", async () => {
    const internal = await items("t.module_key = 'submittals' and w.current_stage_key = 'internal_review'");
    expect(internal.length).toBe(12);
    for (const target of internal) {
      await expectHiddenFrom({ read: submittals, target, seenBy: [id.ali, id.hafiz], hiddenFrom: [id.ahmed, id.mohammed, id.faisal], name: named, label: "RP-1217-1" });
    }
    // Every Submitted original (a revised Code C item's Rev 1 is not Submitted yet, so the Consultant reads the original).
    const submitted = await items("t.module_key = 'submittals' and w.revision_no = 0 and w.current_stage_key <> 'internal_review'");
    const seen = new Set((await submittals(id.ahmed)).map((r) => r.id));
    expect(submitted.length).toBeGreaterThan(0);
    expect(submitted.filter((s) => !seen.has(s))).toEqual([]); // not hidden-from: what Ahmed must read, none missing
  });

  it("RP-1217-2: Beta Build, a Contractor on it too, reads none of TMC's items, though it reads the Project", async () => {
    const tmc = await items("true");
    expect((await project(id.yousef)).map((r) => r.id)).toEqual([projectId]);
    const [submittal] = await items("t.module_key = 'submittals'");
    const [snag] = await items("t.code = 'SNG' and w.current_stage_key <> 'draft'");
    await expectHiddenFrom({ read: workItem(submittal!), target: submittal!, seenBy: id.hafiz, hiddenFrom: id.yousef, name: named, label: "RP-1217-2" });
    await expectHiddenFrom({ read: snagList, target: snag!, seenBy: id.hafiz, hiddenFrom: id.yousef, name: named, label: "RP-1217-2" });
    // The rest of TMC's items as well, each proved above by Hafiz's read of the same kind.
    const lists = [...(await submittals(id.yousef)), ...(await snagList(id.yousef))].map((r) => r.id);
    expect(lists.filter((x) => tmc.includes(x))).toEqual([]); // not hidden-from: the sweep after the by-id proofs above
  });

  it("RP-1217-3: the Recommended Code and Internal Note events stay with Design Consultants", async () => {
    const [item] = await items("w.current_stage_key = 'pending_approval' and exists (select from work_item_event e where e.work_item_id = w.id and e.type = 'recommend_code')");
    const internal = (as: string) =>
      rowsAs<{ id: string }>(as, sql`select id from work_item_event where work_item_id = ${item!}::uuid and type in ('recommend_code', 'internal_note') order by id`);
    const events = (await migrator.query("select id from work_item_event where work_item_id = $1 and type in ('recommend_code', 'internal_note')", [item])).rows;
    expect(events.length).toBeGreaterThan(0);
    for (const { id: target } of events) {
      await expectHiddenFrom({ read: internal, target, seenBy: [id.mohammed, id.ahmed], hiddenFrom: [id.ali, id.hafiz, id.faisal], name: named, label: "RP-1217-3" });
    }
  });

  it("RP-1217-4: the Mechanical-only Consultant Engineer reads only the Mechanical Submittals", async () => {
    const electrical = await items("t.module_key = 'submittals' and d.code = 'EL' and w.current_stage_key = 'pending_approval'");
    await expectHiddenFrom({ read: submittals, target: electrical[0]!, seenBy: id.ahmed, hiddenFrom: id.sara, name: named, label: "RP-1217-4" });
    const mechanical = new Set(await items("d.code = 'ME'"));
    const seen = (await submittals(id.sara)).map((r) => r.id);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => !mechanical.has(s))).toEqual([]); // not hidden-from: every item Sara reads is Mechanical
  });

  it("RP-1217-5: Nasser, who is not on it, reads neither the Project nor its items", async () => {
    await expectHiddenFrom({ read: project, target: projectId, seenBy: [id.ali, id.yousef], hiddenFrom: id.nasser, name: named, label: "RP-1217-5" });
    const [item] = await items("t.module_key = 'submittals' and w.current_stage_key = 'approved'");
    await expectHiddenFrom({ read: workItem(item!), target: item!, seenBy: id.ahmed, hiddenFrom: id.nasser, name: named, label: "RP-1217-5" });
  });
});
