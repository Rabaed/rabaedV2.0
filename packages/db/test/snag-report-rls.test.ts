// Seam 2 for the Snag report (RP-677, spec RP-619; migration 20270930000000_snag_report.sql; visibility.md
// V3, scenario RP-677-2), as the app role: a report's snapshot is read by nobody through the table; its asker
// alone learns where it is (app.snag_report_state), another Member of the same Project, a Member of no
// Project and a made-up id learn nothing; only the worker, with no Member set, reads what to print and saves
// the PDF; and a Member who is not on the Project cannot ask for a report of it. RP-1003: the database alone
// holds RP-677-1, "a photo only where row-level security shows it": a photo key the asker may not read as a
// Document (another Company's Draft photo, a waiting After photo, a key that is no Document) is refused, and a
// report is found under its own Project's id only.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let projectId = "";
let asker = "";
let colleague = "";
let outsider = "";
/** The outsider's own Project: the positive control beside each refusal to them. */
let outsidersProjectId = "";
let tower: SeamTwoTower<{ otherProject: true }>;

/** A report with no items of a Project named `projectName` (the Tower's, unless another is given). */
let content: { projectName: unknown; items: unknown[]; capped: boolean };
/** Each Project's name, which a report must print as it is (RP-1078). */
const projectNames = new Map<string, unknown>();
const sha = (s: string) => createHash("sha256").update(s).digest();

/** The error code `query` fails with as Member `memberId` (or as the worker, with none), or null. */
async function failure(memberId: string | null, query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    if (memberId) await withMember(app, memberId, (trx) => query.execute(trx));
    else await query.execute(app);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const request = (memberId: string, project: string) =>
  withMember(app, memberId, async (trx) => {
    const c = { ...content, projectName: projectNames.get(project) };
    const { rows } = await sql<{ id: string | null }>`select app.request_snag_report(${project}::uuid, 'en', ${JSON.stringify(c)}::jsonb, now()) as id`.execute(trx);
    return rows[0]!.id;
  });

const state = (memberId: string, id: string, project = projectId) =>
  withMember(
    app,
    memberId,
    async (trx) =>
      (await sql<{ status: string; storage_key: string | null }>`select status, storage_key from app.snag_report_state(${project}::uuid, ${id}::uuid)`.execute(trx)).rows,
  );

/** A report's content holding one item with the photo stored under `key`. */
const withPhoto = (key: string, row: object = {}) => ({ ...content, items: [{ ...row, photo: { storageKey: key, contentType: "image/jpeg", size: 1 } }] });
/** `memberId` asks for a report of `c` on the Tower's Project: its id, or null when refused. */
const ask = (memberId: string, c: unknown) =>
  withMember(app, memberId, async (trx) => (await sql<{ id: string | null }>`select app.request_snag_report(${projectId}::uuid, 'en', ${JSON.stringify(c)}::jsonb, now()) as id`.execute(trx)).rows[0]!.id);
/**
 * Item `id`'s row as the Snag List shows it to `as` (RP-1078), read here from the tables for the plain cases these
 * tests make (no Owner review, no Send Back): its Stage as app.step_as_seen gives it, who it is with as
 * app.work_item_holder gives it (the Member's own person, else the Company by name), Step Age at `now`.
 */
async function rowOf(as: string, id: string, now = new Date()) {
  const [step] = await tower.call<{ stage_key: string; entered_at: Date }>(as, sql`select stage_key, entered_at from app.step_as_seen(${id}::uuid)`);
  const [holder] = await tower.call<{ participant_id: string; assignee_member_id: string | null }>(as, sql`select * from app.work_item_holder(${id}::uuid)`);
  const own = await tower.call<{ id: string }>(as, sql`select app.current_participant_ids() as id`);
  const { rows } = await migrator.query(
    `select w.id, w.document_number, w.title, t.name as type, tv.name as trade, lv.name as location, st.name as stage, st.category,
       (select co.legal_name from participant p join company co on co.id = p.company_id where p.id = $3) as company,
       (select m.full_name from member m where m.id = $4) as person
     from work_item w
     join work_item_type t on t.id = w.work_item_type_id
     join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = $2
     join work_item_dimension_value dt on dt.work_item_id = w.id join dimension_value tv on tv.id = dt.dimension_value_id and tv.id = $5
     left join work_item_dimension_value dl on dl.work_item_id = w.id and dl.dimension_value_id = $6 left join dimension_value lv on lv.id = dl.dimension_value_id
     where w.id = $1`,
    [id, step!.stage_key, holder?.participant_id ?? null, holder?.assignee_member_id ?? null, tower.tradeId, tower.buildingA],
  );
  const r = rows[0];
  const open = r.category === "draft" || r.category === "in_progress";
  const ownHolder = holder && own.some((p) => p.id === holder.participant_id);
  return {
    id,
    documentNumber: r.document_number,
    subject: r.title,
    type: r.type,
    trade: r.trade,
    location: r.location,
    stage: r.stage,
    with: !open || !holder ? null : ownHolder ? (r.person ?? r.company) : r.company,
    stepAgeWeeks: open && r.document_number ? Math.floor((now.getTime() - step!.entered_at.getTime()) / (7 * 24 * 3600 * 1000)) + 1 : null,
  };
}
const storageKey = async (documentId: string) =>
  (await migrator.query<{ storage_key: string }>("select storage_key from document where id = $1", [documentId])).rows[0]!.storage_key;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // This file's own Tower (RP-995): its Project, C1's Project Manager who asks, C1's Engineer, a colleague on it, and
  // an outsider, the Authorized Person of another Project, who is on none of its Participants.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RSN", otherProject: true, checklistTemplate: false });
  projectId = tower.projectId;
  asker = tower.c1.members.project_manager;
  colleague = tower.c1.members.engineer;
  outsider = tower.other.ap;
  outsidersProjectId = tower.other.projectId;
  const names = await migrator.query<{ id: string; name: unknown }>("select id, name from project where id = any($1::uuid[])", [[projectId, outsidersProjectId]]);
  for (const r of names.rows) projectNames.set(r.id, r.name);
  content = { projectName: projectNames.get(projectId), items: [], capped: false };
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("the snag_report table", () => {
  it("is not read by the app role at all: the snapshot goes to the worker through its function only", async () => {
    expect(await failure(asker, sql`select * from snag_report`)).toBe("42501");
    expect(await failure(null, sql`select id from snag_report`)).toBe("42501");
  });
});

describe("a report, from request to PDF", () => {
  let id = "";
  let outbox = "";
  /** Reports the colleague and the outsider ask for themselves: the positive controls beside each refusal to them. */
  let colleaguesId = "";
  let outsidersId = "";

  it("is asked for by a Member of the Project only", async () => {
    expect(await request(outsider, projectId)).toBeNull();
    // Positive control: the outsider asks for one of their own Project.
    outsidersId = (await request(outsider, outsidersProjectId))!;
    expect(outsidersId).toBeTruthy();
    id = (await request(asker, projectId))!;
    expect(id).toBeTruthy();
    colleaguesId = (await request(colleague, projectId))!;
    expect(colleaguesId).toBeTruthy();
    const { rows } = await migrator.query<{ id: string }>("select outbox_id as id from snag_report where id = $1", [id]);
    outbox = rows[0]!.id;
    // The job row holds ids only, never an item's text.
    const job = await migrator.query<{ kind: string; payload: unknown }>("select kind, payload from outbox where id = $1", [outbox]);
    expect(job.rows[0]).toEqual({ kind: "snag_report", payload: { snag_report_id: id } });
  });

  it("refuses a photo that is not under the Project's own files", async () => {
    expect(await ask(asker, withPhoto(`projects/${randomUUID()}/work-items/x/photo.jpg`))).toBeNull();
    // Positive control: the same asker, with no photo.
    expect(await ask(asker, content)).toBeTruthy();
  });

  it("is preparing to its asker, and nothing to a colleague on the Project, a Member of no Project and a made-up id", async () => {
    expect(await state(asker, id)).toEqual([{ status: "preparing", storage_key: null }]);
    expect(await state(colleague, id)).toEqual([]);
    expect(await state(outsider, id)).toEqual([]);
    expect(await state(asker, randomUUID())).toEqual([]);
    // Positive controls: the colleague and the outsider each read their own report, and the asker reads neither.
    expect(await state(colleague, colleaguesId)).toEqual([{ status: "preparing", storage_key: null }]);
    expect(await state(outsider, outsidersId, outsidersProjectId)).toEqual([{ status: "preparing", storage_key: null }]);
    expect(await state(asker, colleaguesId)).toEqual([]);
    expect(await state(asker, outsidersId)).toEqual([]);
  });

  it("is found under its own Project's id only, never under another Project of its asker", async () => {
    // C1's Authorized Person is on the Tower and on a Project of their own: their Tower report is not under that one.
    const [second] = await tower.call<{ project_id: string }>(
      tower.c1.ap,
      sql`select project_id from app.create_project('{"en": "Annex", "ar": "ملحق"}'::jsonb, 'RSM', 'contractor')`,
    );
    const apsId = (await request(tower.c1.ap, projectId))!;
    expect(apsId).toBeTruthy();
    expect(await state(tower.c1.ap, apsId, second!.project_id)).toEqual([]);
    expect(await state(tower.c1.ap, apsId, randomUUID())).toEqual([]);
    // Positive control: under its own Project's id it is there.
    expect(await state(tower.c1.ap, apsId)).toEqual([{ status: "preparing", storage_key: null }]);
  });

  it("is printed from the snapshot by the worker alone", async () => {
    const job = (memberId: string | null) => failure(memberId, sql`select * from app.snag_report_job(${outbox}::uuid)`);
    expect(await job(asker)).toBe("42501");
    expect(await job(null)).toBeNull();
    expect(await failure(asker, sql`select app.save_snag_report(${outbox}::uuid, 'k', ${sha("x")}, 1)`)).toBe("42501");
  });

  it("is ready to its asker once the worker saves the PDF, still nothing to anyone else, and is saved once", async () => {
    const key = `projects/${projectId}/snag-reports/${id}/snag-report.pdf`;
    const save = () => sql<{ saved: boolean }>`select app.save_snag_report(${outbox}::uuid, ${key}, ${sha(key)}, 10) as saved`.execute(app).then((r) => r.rows[0]!.saved);
    expect(await save()).toBe(true);
    expect(await save()).toBe(false);
    expect(await state(asker, id)).toEqual([{ status: "ready", storage_key: key }]);
    expect(await state(colleague, id)).toEqual([]);
    expect(await state(outsider, id)).toEqual([]);
    expect(await state(colleague, colleaguesId)).toEqual([{ status: "preparing", storage_key: null }]);
    expect(await state(outsider, outsidersId, outsidersProjectId)).toEqual([{ status: "preparing", storage_key: null }]);
    const job = await sql`select * from app.snag_report_job(${outbox}::uuid)`.execute(app);
    expect(job.rows).toEqual([]);
  });
});

describe("a report's photos are only ones its asker reads as Documents (RP-1003, RP-677-1)", () => {
  /** A Snag on Building A by `raiser`: its id, in Draft. */
  async function drafted(raiser: string, title: string): Promise<string> {
    const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
      raiser,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
        ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }

  /** `as` confirms the upload `documentId` started on item `id`, as the api does once the file is stored; its storage key. */
  async function confirmed(as: string, id: string, documentId: string): Promise<string> {
    expect(
      await tower.outcome(as, sql`select app.confirm_document_upload(${id}::uuid, ${documentId}::uuid, 10, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`),
    ).toBe("confirmed");
    return storageKey(documentId);
  }

  /** C1's PM's Draft Snag with one photo: the item and the photo's id and storage key. */
  async function draftPhoto(title: string): Promise<{ id: string; documentId: string; key: string }> {
    const id = await drafted(asker, title);
    const [started] = await tower.call<{ outcome: string; document_id: string }>(
      asker,
      sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'before.jpg', 10, 'image/jpeg', now(), 'photos')`,
    );
    expect(started!.outcome).toBe("started");
    return { id, documentId: started!.document_id, key: await confirmed(asker, id, started!.document_id) };
  }

  it("refuses another Company's Draft photo, though its key is under the Project's own prefix; C1's Members ask with it", async () => {
    const { id, key } = await draftPhoto("Chipped column");
    expect(key.startsWith(`projects/${projectId}/`)).toBe(true);
    for (const other of [tower.k1.members.engineer, tower.ow.members.representative, tower.c2.members.engineer]) {
      expect(await ask(other, withPhoto(key))).toBeNull();
      // Positive control: the same Member asks for a report without it.
      expect(await ask(other, content)).toBeTruthy();
    }
    expect(await ask(asker, withPhoto(key, await rowOf(asker, id)))).toBeTruthy();
    expect(await ask(colleague, withPhoto(key, await rowOf(colleague, id)))).toBeTruthy();
  });

  it("refuses a waiting After photo to the raiser and the Owner, who see the Snag; C1, holding it, asks with it", async () => {
    const k1 = tower.k1.members.engineer;
    const id = await drafted(k1, "Cable tray not bonded");
    expect(await tower.take(k1, id, "raise")).toBe("applied");
    expect(await tower.pickUp(asker, id)).toBe("picked_up");
    expect(await tower.take(asker, id, "start_work")).toBe("applied");
    expect(await tower.pickUp(asker, id)).toBe("picked_up");
    const [started] = await tower.call<{ outcome: string; document_id: string }>(
      asker,
      sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'after.jpg', 10, 'image/jpeg', now())`,
    );
    expect(started!.outcome).toBe("started");
    const key = await confirmed(asker, id, started!.document_id);
    for (const other of [k1, tower.ow.members.representative]) {
      expect(await tower.call<{ id: string }>(other, sql`select id from work_item where id = ${id}::uuid`)).toEqual([{ id }]);
      expect(await ask(other, withPhoto(key, await rowOf(other, id)))).toBeNull();
      // Positive control: the same row with no photo is theirs to print.
      expect(await ask(other, { ...content, items: [{ ...(await rowOf(other, id)), photo: null }] })).toBeTruthy();
    }
    expect(await ask(asker, withPhoto(key, await rowOf(asker, id)))).toBeTruthy();
  });

  it("refuses a key under the Project's prefix that is no Document, and a removed photo", async () => {
    const { id, documentId, key } = await draftPhoto("Loose cover plate");
    expect(await ask(asker, withPhoto(`projects/${projectId}/work-items/${randomUUID()}/documents/${randomUUID()}`, await rowOf(asker, id)))).toBeNull();
    expect(await ask(asker, withPhoto(key, await rowOf(asker, id)))).toBeTruthy();
    expect(await tower.outcome(asker, sql`select app.remove_document(${id}::uuid, ${documentId}::uuid, now()) as outcome`)).toBe("removed");
    expect(await ask(asker, withPhoto(key, await rowOf(asker, id)))).toBeNull();
  });
});

// RP-1078: the database alone holds "a report holds only the items its asker reads through the Snag List"
// (RP-677-1). Each row names its item, and must be exactly what the List shows the asker for it; anything
// else is refused, whoever calls it. K1 raises a Snag on C1: C1 and K1 see it, C2 (Building B only) does not.
describe("RP-1078: a report's rows are only what the Snag List shows its asker", () => {
  let snag = "";
  const k1 = () => tower.k1.members.engineer;
  const c2 = () => tower.c2.members.engineer;
  const report = (...items: object[]) => ({ ...content, items });

  beforeAll(async () => {
    const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
      k1(),
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', 'Fire stopping missing', app.latest_form_version('SNG'), ${JSON.stringify({ description: "Fire stopping missing" })}::jsonb,
        ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
    );
    snag = created!.work_item_id;
    expect(await tower.take(k1(), snag, "raise")).toBe("applied");
  });

  it("holds the item as C1 and as K1 each read it", async () => {
    const asC1 = await rowOf(asker, snag);
    const asK1 = await rowOf(k1(), snag);
    // With C1: by Company name to K1 (V14), and by Company to C1 too while no one of C1 has picked it up.
    expect(asK1.with).toEqual(asC1.with);
    expect(asK1.stepAgeWeeks).toBe(1);
    expect(await ask(asker, report({ ...asC1, photo: null }))).toBeTruthy();
    expect(await ask(k1(), report({ ...asK1, photo: null }))).toBeTruthy();
  });

  it("refuses an item the asker does not see: C2 asks with C1's row of K1's Snag", async () => {
    expect(await ask(c2(), report(await rowOf(asker, snag)))).toBeNull();
    // Positive control: C2 asks for a report with no rows.
    expect(await ask(c2(), content)).toBeTruthy();
  });

  it("refuses a row whose printed fields are not the item's", async () => {
    const row = await rowOf(asker, snag);
    for (const changed of [
      { subject: "Another Company's Subject" },
      { documentNumber: "RST-SNG-9999" },
      { stage: { en: "Closed", ar: "مغلق" } },
      { location: null },
      { with: { en: "K1", ar: "K1" } },
      { stepAgeWeeks: 9 },
      { extra: "printed too" },
    ]) {
      expect(await ask(asker, report({ ...row, ...changed })), JSON.stringify(changed)).toBeNull();
    }
    // One item's fields under another's id.
    const other = await tower.call<{ id: string }>(asker, sql`select id from work_item where project_id = ${projectId}::uuid and id <> ${snag}::uuid limit 1`);
    expect(await ask(asker, report({ ...row, id: other[0]!.id }))).toBeNull();
    // Positive control: the row as it is.
    expect(await ask(asker, report(row))).toBeTruthy();
  });

  it("refuses a row with no id, a made-up id, and another Project's name", async () => {
    const { id: _id, ...noId } = await rowOf(asker, snag);
    expect(await ask(asker, report(noId))).toBeNull();
    expect(await ask(asker, report({ ...noId, id: "not-a-uuid" }))).toBeNull();
    expect(await ask(asker, report({ ...noId, id: randomUUID() }))).toBeNull();
    expect(await ask(asker, { ...content, projectName: projectNames.get(outsidersProjectId) })).toBeNull();
  });
});
