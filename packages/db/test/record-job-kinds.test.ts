// Seam 2 for the record-job kinds (RP-1086; migration 20271105000000_record_clean_up.sql): the kinds
// and the payload key naming each one's item are written once, in app.record_job_payload_keys, and
// every record-job function reads them from there. Read as the migrator: these helpers are not the
// app role's to run.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: pg.Client;
let appDb: Db;
let projectId = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  app = new pg.Client({ connectionString: urls.app });
  await Promise.all([migrator.connect(), app.connect()]);
  appDb = createDb(urls.app, { max: 2 });
  projectId = (await buildSeamTwoTower(appDb, migrator, { projectCode: "RJK" })).projectId;
});
afterAll(async () => {
  await Promise.all([migrator?.end(), app?.end(), appDb?.destroy()]);
});

const one = async <T>(q: string, args: unknown[] = []) => (await migrator.query<{ v: T }>(q, args)).rows[0]!.v;

describe("the record-job kinds", () => {
  it("are the Documental Record job and its Re-produce", async () => {
    expect(await one<string[]>("select app.record_job_kinds() as v")).toEqual(["documental_record", "documental_record_reproduce"]);
  });

  it("each name their item under their own payload key", async () => {
    const id = randomUUID();
    const item = (kind: string, payload: object) => one<string | null>("select app.record_job_item($1, $2::jsonb) as v", [kind, JSON.stringify(payload)]);
    expect(await item("documental_record", { closed_work_item_id: id })).toBe(id);
    expect(await item("documental_record_reproduce", { work_item_id: id, admin_action_id: randomUUID() })).toBe(id);
    // The other kind's key is not read: one key per kind.
    expect(await item("documental_record", { work_item_id: id })).toBeNull();
    expect(await item("email", { work_item_id: id })).toBeNull();
  });

  it("are not the app role's to run, nor are the record's facts helpers", async () => {
    for (const fn of [
      "app.record_job_payload_keys()",
      "app.record_job_kinds()",
      "app.record_job_pending('documental_record', gen_random_uuid())",
      // The record's facts read every Participant on an item: only the worker's app.documental_record_facts calls them.
      "app.record_fact_companies(gen_random_uuid())",
      "app.record_fact_comments(gen_random_uuid())",
      "app.record_fact_transitions(gen_random_uuid())",
    ]) {
      await expect(app.query(`select ${fn}`), fn).rejects.toThrow(/permission denied/);
    }
  });
});

describe("app.record_job_pending", () => {
  it("finds a waiting job of the kind for the item, by the kind's own key", async () => {
    const id = randomUUID();
    const pending = (kind: string) => one<boolean>("select app.record_job_pending($1, $2) as v", [kind, id]);
    expect(await pending("documental_record")).toBe(false);
    await migrator.query("begin");
    try {
      await migrator.query("insert into outbox (kind, project_id, payload) values ('documental_record', $2, jsonb_build_object('closed_work_item_id', $1::uuid))", [id, projectId]);
      expect(await pending("documental_record")).toBe(true);
      expect(await pending("documental_record_reproduce")).toBe(false);
    } finally {
      await migrator.query("rollback");
    }
  });
});
