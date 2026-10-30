// Seam 2 for "record ready" and the record's state on the item (scenarios RP-155-1, RP-155-2 and
// RP-950-1; RP-155, RP-950, RP-1083; spec RP-632; ADR 0023; visibility.md, the Notifications and
// emails row and the Documental Record row), as the app role. The worker saves the record of a
// closed item and publishes it once its checks pass (app.save_documental_record,
// app.finish_documental_record, as the app role with no Member set), which queues one `record_ready`
// job; app.deliver_record_ready then gives each active Member of the Project who sees the item at
// delivery one notification, routed by their "Items I watch" setting, unless they muted the
// Project, and nothing at all once the Project is closed. Seam 1: record-checks.test.ts.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `RY${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const verificationCode = () => Array.from({ length: 9 }, (_, i) => (i === 4 ? "-" : CODE_ALPHABET[randomInt(CODE_ALPHABET.length)])).join("");
const sha = (s: string) => createHash("sha256").update(s).digest();

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RRY", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
/** The closed item whose record passes its checks. */
let passed = "";
/** Another closed item, whose record fails them. */
let failed = "";

const one = async (text: string, values: unknown[]): Promise<string | undefined> => (await migrator.query(text, values)).rows[0]?.id as string | undefined;
const job = async (kind: string, key: string, id: string) => {
  const found = await one("select id from outbox where kind = $1 and payload ->> $2 = $3 order by created_at desc, id desc limit 1", [kind, key, id]);
  if (!found) throw new Error(`no ${kind} job for ${id}`);
  return found;
};

/** What `as` reads of the record of item `id` on the item: `preparing`, `published` or nothing. */
const stateOf = (as: string, id: string) =>
  withMember(app, as, (trx) => sql<{ state: string | null }>`select app.documental_record_state(${id}::uuid) as state`.execute(trx)).then((r) => r.rows[0]!.state);
const recordFile = (as: string, id: string) =>
  withMember(app, as, (trx) => sql<{ storage_key: string }>`select storage_key from app.documental_record_file(${id}::uuid)`.execute(trx)).then((r) => r.rows);

/** The worker saves the record of closed item `id` (its job's PDF and Record Data), still to be checked. */
async function save(id: string): Promise<string> {
  const outbox = await job("documental_record", "closed_work_item_id", id);
  const key = `projects/${tower.projectId}/work-items/${id}/documental-record/record.pdf`;
  const saved = await sql<{ saved: boolean }>`
    select app.save_documental_record(${outbox}::uuid, ${key}, ${sha(key)}, 10, ${key.replace("record.pdf", "record-data.xml")}, ${sha(id)}, 10,
      '1', 'bilingual', now(), ${sha(randomUUID())}, ${verificationCode()}) as saved`.execute(app);
  expect(saved.rows[0]!.saved).toBe(true);
  return outbox;
}

/** The worker's checks on record job `outbox`: passed, or failed with a finding. */
const finish = (outbox: string, ok: boolean) =>
  sql<{ done: boolean }>`select app.finish_documental_record(${outbox}::uuid, ${ok}, ${JSON.stringify(ok ? [] : ["no seal"])}::jsonb) as done`
    .execute(app)
    .then((r) => r.rows[0]!.done);

/** The worker delivers `record_ready` job `outbox`; returns how many notifications it wrote. */
const deliver = (outbox: string) => sql<{ n: number }>`select app.deliver_record_ready(${outbox}::uuid) as n`.execute(app).then((r) => r.rows[0]!.n);

/** Who `record_ready` job `outbox` notified, and how, as the owner reads it. */
const notified = async (outbox: string) =>
  new Map(
    (await migrator.query<{ member_id: string; in_app: boolean; email: string }>("select member_id, in_app, email from notification where outbox_id = $1", [outbox])).rows.map(
      (r) => [r.member_id, { inApp: r.in_app, email: r.email }],
    ),
  );

/** C1's item at K1's Engineer, sent to the Manager and closed at Code A; returns its id. */
async function closedAtA(title: string): Promise<string> {
  const id = await wirAtConsultant(tower, { type: TYPE, title });
  expect(await tower.take(tower.k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await tower.pickUp(tower.k1.members.manager, id)).toBe("picked_up");
  expect(await tower.take(tower.k1.members.manager, id, "approve_a")).toBe("applied");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1083 record ready ${digits(6)}`) });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-1083 ready)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [formId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-1083 ready)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  passed = await closedAtA("Slab pour, Level 1");
  failed = await closedAtA("Slab pour, Level 2");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-155-2: the record's state on the item, as its job waits, passes and fails", () => {
  it("says 'preparing' while the job waits, to a Member who sees the item only: C2 reads nothing, as for a made-up id", async () => {
    const { c1, k1, c2 } = tower;
    for (const seer of [c1.members.project_manager, k1.members.manager]) expect(await stateOf(seer, passed), seer).toBe("preparing");
    expect(await stateOf(c2.members.engineer, passed)).toBeNull();
    expect(await stateOf(c2.members.engineer, randomUUID())).toBeNull();
    expect(await stateOf(c1.members.project_manager, randomUUID())).toBeNull();
  });

  it("goes on saying 'preparing' once the record is saved, and 'published' once it passes its checks", async () => {
    const { c1, k1, c2 } = tower;
    const outbox = await save(passed);
    expect(await stateOf(c1.members.project_manager, passed)).toBe("preparing");
    expect(await recordFile(c1.members.project_manager, passed)).toEqual([]);
    expect(await finish(outbox, true)).toBe(true);
    for (const seer of [c1.members.project_manager, k1.members.manager]) expect(await stateOf(seer, passed), seer).toBe("published");
    expect(await stateOf(c2.members.engineer, passed)).toBeNull();
    expect(await recordFile(c1.members.project_manager, passed)).toHaveLength(1);
    expect(await recordFile(c2.members.engineer, passed)).toEqual([]);
    // Positive control: C2 reads the state and the file of a published record on an item it sees (its own Draft,
    // which the owner gives one).
    const own = await c2Draft(tower, { type: "WIR", title: "Column pour" });
    const key = `projects/${tower.projectId}/work-items/${own}/documental-record/record.pdf`;
    const file = async (k: string, mime: string) => one("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime]);
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code)
       values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, $7)`,
      [tower.projectId, own, await file(key, "application/pdf"), await file(`${key}.xml`, "application/xml"), sha("pdf"), sha(randomUUID()), verificationCode()],
    );
    expect(await stateOf(c2.members.engineer, own)).toBe("published");
    expect(await recordFile(c2.members.engineer, own)).toEqual([{ storage_key: key }]);
  });

  it("shows nothing for a record that failed its checks, as for an item with no record: its download is the plain 404 for everyone, and nobody is told it is ready", async () => {
    const { c1, k1, ow, c2 } = tower;
    expect(await finish(await save(failed), false)).toBe(true);
    for (const seer of [c1.members.project_manager, k1.members.manager, ow.members.representative, c2.members.engineer]) {
      expect(await stateOf(seer, failed), seer).toBeNull();
      expect(await recordFile(seer, failed), seer).toEqual([]);
    }
    expect(await one("select id from outbox where kind = 'record_ready' and payload ->> 'work_item_id' = $1", [failed])).toBeUndefined();
  });
});

describe("scenarios RP-155-1 and RP-950-1: record ready reaches each Member who sees the item, as their settings route it", () => {
  let outbox = "";
  let delivered = 0;

  beforeAll(async () => {
    const { c1, k1, ow, c2 } = tower;
    const watched = (member: string, email: string) =>
      tower.call(
        member,
        // The "Items I watch" group keeps which outcomes it follows: all of them here, as by default.
        sql<object>`insert into notification_setting (member_id, notification_group, email, outcomes)
          values (${member}::uuid, 'watched', ${email}, '{A,B,C,D,passed,passed_with_comments,failed,approved,rejected,cancelled}')`,
      );
    // C1's PM and Engineer chose "Items I watch" email immediately; K1's Manager kept the default (the daily digest);
    // the Owner's Representative turned it off; C2's Engineer, who never saw the item, chose immediately.
    await watched(c1.members.project_manager, "immediate");
    await watched(c1.members.engineer, "immediate");
    await watched(ow.members.representative, "off");
    await watched(c2.members.engineer, "immediate");
    // K1's Engineer muted the Project.
    expect(await tower.outcome(k1.members.engineer, sql`select app.set_project_mute(${tower.projectId}::uuid, true) as outcome`)).toBe("set");
    outbox = await job("record_ready", "work_item_id", passed);
    delivered = await deliver(outbox);
  });

  it("RP-155-1: reaches, once, each Member who sees the item; C2's Engineer and the Member who muted the Project get nothing", async () => {
    const { c1, k1, ow, c2 } = tower;
    const got = await notified(outbox);
    expect(delivered).toBe(got.size);
    for (const seer of [c1.members.project_manager, c1.members.engineer, k1.members.manager, ow.members.representative]) {
      expect(got.get(seer)?.inApp, seer).toBe(true);
    }
    expect(got.has(c2.members.engineer)).toBe(false);
    expect(got.has(c2.ap)).toBe(false);
    expect(got.has(k1.members.engineer)).toBe(false);
    // Every Member it reached sees the item; nobody is told twice.
    for (const member of got.keys()) {
      const sees = await withMember(app, member, (trx) => sql<{ sees: boolean }>`select app.sees_work_item(${passed}::uuid) as sees`.execute(trx));
      expect(sees.rows[0]!.sees, member).toBe(true);
    }
    expect(await deliver(outbox)).toBe(0);
    expect((await notified(outbox)).size).toBe(got.size);
  });

  it("RP-950-1: is routed by each Member's \"Items I watch\": email at once, the daily digest by default, or the bell only", async () => {
    const { c1, k1, ow } = tower;
    const got = await notified(outbox);
    expect(got.get(c1.members.project_manager)).toEqual({ inApp: true, email: "immediate" });
    expect(got.get(c1.members.engineer)).toEqual({ inApp: true, email: "immediate" });
    expect(got.get(k1.members.manager)).toEqual({ inApp: true, email: "digest" });
    expect(got.get(ow.members.representative)).toEqual({ inApp: true, email: "none" });
  });

  it("RP-155-1: names nothing but the item: each Member reads their own notification of it, and C2 reads none", async () => {
    const { c1, c2 } = tower;
    const read = (as: string) =>
      tower.call<Record<string, unknown>>(as, sql`select kind, work_item_id, project_id from notification where outbox_id = ${outbox}::uuid`);
    expect(await read(c1.members.project_manager)).toEqual([{ kind: "record_ready", work_item_id: passed, project_id: tower.projectId }]);
    expect(await read(c2.members.engineer)).toEqual([]);
    // The row holds no text: no Company, no person, no file (the item is all it points at).
    const { rows } = await migrator.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notification' order by column_name",
    );
    expect(rows.map((r) => r.column_name).filter((c) => /name|text|body|subject|company|storage|file|payload/.test(c))).toEqual([]);
  });

  it("RP-155-1: reaches the Member who muted the Project once they unmute it, and still never C2", async () => {
    // Positive control beside the muted Member's silence: K1's Engineer sees the item, so the mute alone kept it away.
    const { k1, c2 } = tower;
    expect(await tower.outcome(k1.members.engineer, sql`select app.set_project_mute(${tower.projectId}::uuid, false) as outcome`)).toBe("set");
    const again = await one("insert into outbox (kind, project_id, payload) values ('record_ready', $1, $2) returning id", [
      tower.projectId,
      JSON.stringify({ work_item_id: passed }),
    ]);
    expect(await deliver(again!)).toBeGreaterThan(0);
    const got = await notified(again!);
    expect(got.get(k1.members.engineer)?.inApp).toBe(true);
    expect(got.has(c2.members.engineer)).toBe(false);
  });

  it("RP-155-1: reaches nobody once the Project is closed", async () => {
    // Another record_ready job of the same item, still in the outbox when the Project closes (the Tower is this file's own).
    const late = await one("insert into outbox (kind, project_id, payload) values ('record_ready', $1, $2) returning id", [
      tower.projectId,
      JSON.stringify({ work_item_id: passed }),
    ]);
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [tower.projectId]);
    try {
      expect(await deliver(late!)).toBe(0);
      expect((await notified(late!)).size).toBe(0);
    } finally {
      await migrator.query("update project set status = 'active', closed_at = null where id = $1", [tower.projectId]);
    }
    // Positive control: the same job, delivered while the Project is active, reaches C1's PM.
    expect(await deliver(late!)).toBeGreaterThan(0);
    expect((await notified(late!)).has(tower.c1.members.project_manager)).toBe(true);
  });
});
