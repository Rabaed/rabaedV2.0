// Seam 2 for the Working Copy (RP-621, spec RP-632; visibility.md, the Working Copy row), as the
// app role: the working_copy table is never read or written directly, what a copy prints is read
// only inside the definer functions, a Member asks only for an item they see, and only the worker,
// with no Member set, reads a job's content and keeps where its PDF is.
//
// What a copy prints (scenarios RP-23-3 and RP-1083-3) is read as the worker reads it
// (app.working_copy_job): the same for every viewer, the item as it last arrived, its Companies by
// name only, and nothing internal to one Participant.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import {
  addOwnerReviewWorkflow,
  addTestScreen,
  addTestWorkflow,
  bilingual,
  buildSeamTwoTower,
  c2Draft,
  digits,
  sha256Bytea,
  testDatabaseUrls,
  wirAtConsultant,
  type SeamTwoTower,
} from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower;
let itemId = "";
let projectId = "";
let seer = "";
let other = "";
/** An item `other` sees: the positive control beside each refusal to `other`. */
let othersItemId = "";

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

const request = (memberId: string, id: string) =>
  withMember(app, memberId, (trx) =>
    sql<{ outcome: string; storage_key: string | null }>`select outcome, storage_key from app.request_working_copy(${id}::uuid, 'test')`.execute(trx),
  ).then((r) => r.rows[0]!);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // This file's own Tower (RP-995): C1's open Submitted WIR, which K1's Engineer holds and sees, and C2's Engineer,
  // another Contractor of the same Trade, doesn't (V3). C2's own Draft is the positive control beside that refusal.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RWC" });
  projectId = tower.projectId;
  itemId = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
  seer = tower.k1.members.engineer;
  other = tower.c2.members.engineer;
  othersItemId = await c2Draft(tower, { type: "WIR", title: "Column pour" });
});

afterAll(async () => {
  // The rows asked for here are this test's own.
  await migrator.query("delete from working_copy where app_version = 'test'");
  await migrator.query("delete from outbox where kind = 'working_copy' and project_id = $1 and processed_at is null", [projectId]);
  await migrator.end();
  await app.destroy();
});

describe("the working_copy table", () => {
  it("is not read or written by the app role at all", async () => {
    expect(await failure(seer, sql`select * from working_copy`)).toBe("42501");
    expect(await failure(null, sql`select id from working_copy`)).toBe("42501");
    expect(
      await failure(
        null,
        sql`insert into working_copy (work_item_id, project_id, content_sha256, app_version) values (${itemId}::uuid, ${projectId}::uuid, ${Buffer.alloc(32)}, 'x')`,
      ),
    ).toBe("42501");
  });
});

describe("what a Working Copy prints", () => {
  it("is read only inside the definer functions, never by the app role", async () => {
    expect(await failure(seer, sql`select app.working_copy_content(${itemId}::uuid)`)).toBe("42501");
    expect(await failure(null, sql`select app.working_copy_content(${itemId}::uuid)`)).toBe("42501");
    expect(await failure(seer, sql`select app.working_copy_draft_answers(${itemId}::uuid)`)).toBe("42501");
  });
});

describe("app.request_working_copy", () => {
  it("is not_found for a Member who doesn't see the item, and for a made-up id, and queues nothing", async () => {
    expect(await request(other, itemId)).toEqual({ outcome: "not_found", storage_key: null });
    expect(await request(seer, randomUUID())).toEqual({ outcome: "not_found", storage_key: null });
    const { rows } = await migrator.query("select 1 from working_copy where work_item_id = $1 and app_version = 'test'", [itemId]);
    expect(rows).toEqual([]);
    // Positive controls: the refused Member is answered for an item they see, and the seer is refused C2's Draft.
    expect(await request(other, othersItemId)).toEqual({ outcome: "preparing", storage_key: null });
    expect(await request(seer, othersItemId)).toEqual({ outcome: "not_found", storage_key: null });
  });

  it("queues one job for a Member who sees the item, however often it is asked", async () => {
    expect(await request(seer, itemId)).toEqual({ outcome: "preparing", storage_key: null });
    expect(await request(seer, itemId)).toEqual({ outcome: "preparing", storage_key: null });
    const { rows } = await migrator.query<{ jobs: string }>(
      `select count(*) as jobs from outbox o join working_copy c on c.outbox_id = o.id
       where c.work_item_id = $1 and c.app_version = 'test' and o.kind = 'working_copy'`,
      [itemId],
    );
    expect(rows[0]!.jobs).toBe("1");
  });

  it("checks access on every ask: once printed, the Member who sees it gets its key, and the one who doesn't gets not_found", async () => {
    // As the worker would have printed it (the migrator stands in for it here).
    await migrator.query(
      "update working_copy set storage_key = 'projects/p/work-items/w/documental-record/working-copies/x.pdf', made_at = now() where work_item_id = $1 and app_version = 'test'",
      [itemId],
    );
    expect(await request(seer, itemId)).toEqual({ outcome: "ready", storage_key: "projects/p/work-items/w/documental-record/working-copies/x.pdf" });
    expect(await request(other, itemId)).toEqual({ outcome: "not_found", storage_key: null });
    expect(await request(other, othersItemId)).toEqual({ outcome: "preparing", storage_key: null });
  });

  it("is refused without a Member set: the worker asks for nothing", async () => {
    const { rows } = await sql<{ outcome: string }>`select outcome from app.request_working_copy(${itemId}::uuid, 'test')`.execute(app);
    expect(rows[0]!.outcome).toBe("not_found");
  });
});

describe("the worker's functions", () => {
  it("refuse a Member", async () => {
    expect(await failure(seer, sql`select app.working_copy_job(${randomUUID()}::uuid)`)).toBe("42501");
    expect(await failure(seer, sql`select app.save_working_copy(${randomUUID()}::uuid, 'k')`)).toBe("42501");
  });

  it("give nothing for a row that is no Working Copy job", async () => {
    const { rows } = await sql<{ job: unknown; saved: boolean }>`
      select app.working_copy_job(${randomUUID()}::uuid) as job, app.save_working_copy(${randomUUID()}::uuid, 'k') as saved
    `.execute(app);
    expect(rows[0]).toEqual({ job: null, saved: false });
  });
});

describe("app.set_project_working_copy_watermark", () => {
  it("is not_found for a Member who is no Project Admin, and changes nothing", async () => {
    // A Member of the Project who is none of its Project Admins (whether they see the item has nothing to do with it).
    const nonAdmin = tower.c1.members.engineer;
    const { rows: admins } = await migrator.query("select 1 from project_admin where project_id = $1 and member_id = $2", [projectId, nonAdmin]);
    expect(admins).toEqual([]);
    const watermark = (as: string, text: string) =>
      withMember(app, as, (trx) =>
        sql<{ outcome: string }>`select app.set_project_working_copy_watermark(${projectId}::uuid, ${JSON.stringify({ en: text, ar: text })}::jsonb) as outcome`.execute(trx),
      ).then((r) => r.rows[0]!.outcome);
    const watermarkNow = async () =>
      (await migrator.query<{ watermark: unknown }>("select working_copy_watermark as watermark from project where id = $1", [projectId])).rows[0]!.watermark;
    expect(await watermark(nonAdmin, "Mine")).toBe("not_found");
    expect(await watermarkNow()).toEqual({ en: "Not Final", ar: "غير نهائي" });
    // Positive control: the Project's Admin (C1's Authorized Person, its creator) does change it.
    expect(await watermark(tower.c1.ap, "Theirs")).toBe("set");
    expect(await watermarkNow()).toEqual({ en: "Theirs", ar: "Theirs" });
  });
});

// What the worker prints, on a Tower of its own whose K1 has a Manager, so K1 has moves inside it.
describe("scenarios RP-23-3 and RP-1083-3: what a Working Copy prints", () => {
  const letters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("");
  const TYPE = `RW${letters()}`;
  const OWNER_TYPE = `RV${letters()}`;
  const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
  const SHARED = "Pour the slab at grid C4";
  const CHANGED = "Changed while C1 holds it";
  /** The Internal Notes written with each move. */
  const NOTES = {
    c1Send: "C1 between us: check the rebar",
    c1Submit: "C1's note on the Submit",
    k1Send: "K1 between us: the crew was rushed",
    k1Return: "K1: redo the check",
  } as const;
  const K1_ANSWER = "K1's own verification, never shared";
  const options = { projectCode: "RWD", k1Manager: true } as const;
  let copyTower: SeamTwoTower<typeof options>;
  let id = "";
  let content: Record<string, unknown>;
  const run = (text: string) => migrator.query(text);

  /** `as` takes `transition` on item `itemId` with `answers` and an Internal Note; returns the outcome. */
  const takeWith = (as: string, itemId: string, transition: string, options: { answers?: object; note?: string } = {}) =>
    copyTower.outcome(
      as,
      sql`select app.take_transition(${itemId}::uuid, ${transition}, ${JSON.stringify(options.answers ?? {})}::jsonb, ${options.note ?? ""},
        app.answers_sha256(${itemId}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    );

  /** `as` adds and confirms Document `fileName` to item `itemId`'s Attachments, as the api does once the file is stored. */
  async function upload(as: string, itemId: string, fileName: string): Promise<void> {
    const [started] = await copyTower.call<{ outcome: string; document_id: string }>(
      as,
      sql`select outcome, document_id from app.start_document_upload(${itemId}::uuid, ${fileName}, 10, 'application/pdf', now(), 'attachments')`,
    );
    expect(started!.outcome).toBe("started");
    expect(
      await copyTower.outcome(
        as,
        sql`select app.confirm_document_upload(${itemId}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${sha256Bytea(fileName)}, now()) as outcome`,
      ),
    ).toBe("confirmed");
  }

  /** C1's Engineer raises an item of `type` with `data`; returns its id. */
  async function raise(type: string, title: string, data: object): Promise<string> {
    const [created] = await copyTower.call<{ outcome: string; work_item_id: string }>(
      copyTower.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${copyTower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify(data)}::jsonb,
        ${copyTower.tradeId}::uuid, ${copyTower.buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }

  /** What the worker prints for item `itemId` once `as` asks for its Working Copy (app.working_copy_job, with no Member set). */
  async function printed(as: string, itemId: string): Promise<Record<string, unknown>> {
    expect(await request(as, itemId)).toEqual({ outcome: "preparing", storage_key: null });
    const { rows } = await migrator.query<{ outbox_id: string }>(
      "select outbox_id from working_copy where work_item_id = $1 and app_version = 'test' and made_at is null and stale_at is null",
      [itemId],
    );
    const job = await sql<{ job: { content: Record<string, unknown> } | null }>`select app.working_copy_job(${rows[0]!.outbox_id}::uuid) as job`.execute(app);
    return job.rows[0]!.job!.content;
  }

  /** Every key in `value`, however deep. */
  const keys = (value: unknown): string[] =>
    Array.isArray(value) ? value.flatMap(keys) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : [];

  beforeAll(async () => {
    const screen = await addTestScreen(
      run,
      `rp1083_${digits(6)}`,
      { sections: [{ key: "verify", title: bilingual("Verify"), fields: [{ key: "k1_view", type: "textarea", label: bilingual("K1's view") }] }] },
      [],
    );
    const workflowId = await addTestWorkflow(run, { name: bilingual(`RP-1083 Working Copy ${digits(6)}`), screens: { send_to_manager: screen } });
    const { rows } = await migrator.query<{ id: string }>("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [
      JSON.stringify(bilingual("Inspection (RP-1083 Working Copy)")),
    ]);
    await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
      rows[0]!.id,
      wirForm,
    ]);
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
      [TYPE, JSON.stringify(bilingual("Inspection (RP-1083 Working Copy)")), workflowId, rows[0]!.id],
    );
    copyTower = await buildSeamTwoTower(app, migrator, options);
    const { c1, k1 } = copyTower;

    // C1 raises it with a Document and Submits it, with an Internal Note on each move.
    const data = { description: SHARED, checklist_template: copyTower.checklistVersionId };
    id = await raise(TYPE, "Slab pour, Level 4", data);
    expect(await copyTower.outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
    await upload(c1.members.engineer, id, "shared.pdf");
    expect(await takeWith(c1.members.engineer, id, "send_for_review", { note: NOTES.c1Send })).toBe("applied");
    expect(await copyTower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await takeWith(c1.members.project_manager, id, "submit", { note: NOTES.c1Submit })).toBe("applied");
    // K1's Engineer sends it to the Manager with K1's own answer and an Internal Note; the Manager Returns it; the Engineer Sends it Back to C1's Draft.
    expect(await copyTower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { answers: { k1_view: K1_ANSWER }, note: NOTES.k1Send })).toBe("applied");
    expect(await copyTower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "return_to_engineer", { note: NOTES.k1Return })).toBe("applied");
    expect(await copyTower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_back_to_draft")).toBe("applied");
    // C1 holds it again, changes its answer and adds a Document: C1's own until it is Submitted again (V19).
    expect(
      await copyTower.outcome(
        c1.members.engineer,
        sql`select app.save_work_item_answers(${id}::uuid, ${JSON.stringify({ ...data, description: CHANGED })}::jsonb, ${copyTower.tradeId}::uuid, ${copyTower.buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
      ),
    ).toBe("saved");
    await upload(c1.members.engineer, id, "held.pdf");
    content = await printed(k1.members.engineer, id);
  });

  afterAll(async () => {
    // This Tower's own rows, the copies first (they name their jobs).
    await migrator.query("delete from working_copy where project_id = $1 and app_version = 'test'", [copyTower.projectId]);
    await migrator.query("delete from outbox where kind = 'working_copy' and project_id = $1 and processed_at is null", [copyTower.projectId]);
  });

  it("RP-1083-3: prints the item as it last arrived: its answers and Documents from before C1 held it again (V19)", () => {
    const form = content.form as { answers: Record<string, unknown> };
    expect(form.answers.description).toBe(SHARED);
    expect(JSON.stringify(content)).not.toContain(CHANGED);
    expect((content.documents as { fileName: string }[]).map((d) => d.fileName)).toEqual(["shared.pdf"]);
  });

  it("RP-1083-3: prints no Internal Note and no answer of a move inside one Participant: only the shared moves", () => {
    const text = JSON.stringify(content);
    for (const hidden of [...Object.values(NOTES), K1_ANSWER]) expect(text, hidden).not.toContain(hidden);
    const moves = content.moves as { kind: string; companyName: { en: string } }[];
    expect(moves.map((m) => [m.companyName.en, m.kind])).toEqual([
      ["C1", "submit"],
      ["K1", "send_back"],
    ]);
  });

  it("RP-23-3: names other Companies by name only: no person, no Signature, no Stamp, no Verification Code", () => {
    const { c1, k1, ow, c2 } = copyTower;
    const text = JSON.stringify(content);
    for (const person of [c1.ap, k1.ap, ow.ap, c2.ap, ...Object.values(c1.members), ...Object.values(k1.members), ...Object.values(ow.members)]) {
      expect(text).not.toContain(person);
    }
    expect((content.companies as object[]).map((c) => Object.keys(c).sort())).toEqual(
      (content.companies as object[]).map(() => ["baseRole", "name", "participantId", "roleName"]),
    );
    expect((content.companies as { name: { en: string } }[]).map((c) => c.name.en)).toEqual(["OW", "K1", "C1"]);
    expect((content.moves as object[]).map((m) => Object.keys(m).sort())).toEqual(
      (content.moves as object[]).map(() => ["at", "companyName", "kind", "label", "participantId", "roleName"]),
    );
    // A Document by what it is, never who added it; the answers only the Form's own fields.
    expect((content.documents as object[]).map((d) => Object.keys(d).sort())).toEqual(
      (content.documents as object[]).map(() => ["contentType", "fieldKey", "fileName", "itemKey", "size", "storageKey", "takenAt"]),
    );
    expect(Object.keys((content.form as { answers: object }).answers).sort()).toEqual(["checklist_template", "description", "location", "trade"]);
    // Nobody's name either: the Tower's Members are named after their Positions, which no Company or move label here uses.
    const names = new Set(["ap", "engineer", "project_manager", "manager", "representative"]);
    expect(
      [...JSON.stringify({ ...content, form: { ...(content.form as object), sections: undefined } }).matchAll(/"(?:en|ar)":"([^"]*)"/g)]
        .map((m) => m[1]!)
        .filter((s) => names.has(s)),
    ).toEqual([]);
    expect(keys(content).filter((k) => /member|signature|signer|stamp|logo|verification|seal|sha256|hash/i.test(k))).toEqual([]);
  });

  it("RP-23-3: is one copy for every viewer: C1's PM, asking too, is given the same one", async () => {
    expect(await request(copyTower.c1.members.project_manager, id)).toEqual({ outcome: "preparing", storage_key: null });
    const { rows } = await migrator.query("select id from working_copy where work_item_id = $1 and app_version = 'test'", [id]);
    expect(rows).toHaveLength(1);
  });

  // V5 and V19 (visibility.md, the Documental Record row): a reply Document only an internal event took (the
  // Owner's review's Recommendation) stays K1's and the Owner's (RP-1079).
  it("RP-1083-3: prints no reply Document only an internal event took, as the Recommendation to the Owner", async () => {
    const { c1, k1 } = copyTower;
    const screen = await addTestScreen(
      run,
      `rp1079_${digits(6)}`,
      {
        sections: [
          {
            key: "reply",
            title: bilingual("Recommendation"),
            fields: [
              { key: "remarks", type: "textarea", label: bilingual("Remarks") },
              { key: "reply_photos", type: "photos", label: bilingual("Photos") },
            ],
          },
        ],
      },
      [],
    );
    const workflowId = await addOwnerReviewWorkflow(run);
    // The Recommendation of B shows the Screen, pinned as publishing would pin it (the owner sets it on the published Version).
    await migrator.query("begin");
    try {
      await migrator.query("alter table workflow_transition disable trigger workflow_transition_published_frozen");
      await migrator.query(
        `update workflow_transition t set screen_key = s.key, screen_version_id = v.id, action_form = v.schema
         from screen_version v join screen s on s.id = v.screen_id
         where v.id = $1 and t.key = 'recommend_b' and t.workflow_version_id in (select id from workflow_version where workflow_definition_id = $2)`,
        [screen, workflowId],
      );
      await migrator.query("alter table workflow_transition enable trigger workflow_transition_published_frozen");
      await migrator.query("commit");
    } catch (error) {
      await migrator.query("rollback");
      throw error;
    }
    const { rows } = await migrator.query<{ id: string }>("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [
      JSON.stringify(bilingual("Owner review (RP-1079)")),
    ]);
    await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
      rows[0]!.id,
      JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
    ]);
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', module_key, $1, $2, $3, 'review_code', $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
      [OWNER_TYPE, JSON.stringify(bilingual("Owner review (RP-1079)")), workflowId, rows[0]!.id],
    );
    // No Rabaed Position both attaches as the Consultant and approves as the Owner in one Module: the Consultant
    // attaches in Inspections only, the Owner approves in Submittals only. So this case gives an OW Member a Position
    // of its own that approves in Inspections, held by nobody else; it and its rows are removed in `finally`.
    const positionKey = `rp1079_approver_${digits(6)}`;
    const position = (
      await migrator.query<{ id: string }>("insert into position (owner_kind, base_role, key, name, sort) values ('rabaed', 'owner', $1, $2, 99) returning id", [
        positionKey,
        JSON.stringify(bilingual("Approver (RP-1079 test)")),
      ])
    ).rows[0]!.id;
    await migrator.query("insert into position_permission (position_id, module_key, permission) values ($1, 'inspections', 'view'), ($1, 'inspections', 'approve')", [
      position,
    ]);
    const { ow } = copyTower;
    const owApprover = (
      await migrator.query<{ id: string }>("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
        ow.id,
        `ow-approver-${randomUUID().slice(0, 8)}@rabaed.test`,
        JSON.stringify(bilingual("approver")),
      ])
    ).rows[0]!.id;
    try {
      await copyTower.call(ow.ap, sql<object>`select app.add_project_member(${ow.participantId}::uuid, ${owApprover}::uuid, now())`);
      for (const kind of ["trade", "location"]) {
        expect(
          await copyTower.outcome(ow.ap, sql`select app.set_member_visibility(${ow.participantId}::uuid, ${owApprover}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
        ).toBe("set");
      }
      expect(
        await copyTower.outcome(ow.ap, sql`select app.set_project_member_positions(${ow.participantId}::uuid, ${owApprover}::uuid, ${[positionKey]}::text[]) as outcome`),
      ).toBe("set");
      const item = await raise(OWNER_TYPE, "Cable trays", { model: "Cable trays" });
      expect(await copyTower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
      expect(await copyTower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
      expect(await copyTower.take(c1.members.project_manager, item, "submit")).toBe("applied");
      expect(await copyTower.pickUp(k1.members.engineer, item)).toBe("picked_up");
      // K1's Engineer photographs the reply and recommends B to the Owner: the Recommendation takes the photo, internal to K1 and the Owner.
      const [started] = await copyTower.call<{ outcome: string; document_id: string }>(
        k1.members.engineer,
        sql`select outcome, document_id from app.start_reply_document_upload(${item}::uuid, 'reply_photos', null, 'reply.jpg', 1024, 'image/jpeg', now())`,
      );
      expect(started!.outcome).toBe("started");
      expect(
        await copyTower.outcome(
          k1.members.engineer,
          sql`select app.confirm_document_upload(${item}::uuid, ${started!.document_id}::uuid, 1024, 'image/jpeg', ${sha256Bytea("reply.jpg")}, now()) as outcome`,
        ),
      ).toBe("confirmed");
      expect(await takeWith(k1.members.engineer, item, "recommend_b", { answers: { remarks: "For the Owner" } })).toBe("applied");
      // While the Owner reviews, C1's PM asks for its Working Copy.
      const copy = await printed(c1.members.project_manager, item);
      expect((copy.documents as { fileName: string }[]).map((d) => d.fileName)).toEqual([]);
    } finally {
      await migrator.query("delete from project_member_position where position_id = $1", [position]);
      await migrator.query("delete from position_permission where position_id = $1", [position]);
      await migrator.query("delete from position where id = $1", [position]);
    }
  });
});
