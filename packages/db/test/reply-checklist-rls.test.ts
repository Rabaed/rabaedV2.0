// Seam 2 for a checklist in a reply Screen (RP-86, INSP-4; ADR 0024 amended 2026-10-19, ADR 0025;
// visibility.md V19 and scenario RP-86-1), as the app role. C1 raises an Inspection on a test Type
// whose Form is the WIR Form document (it picks a Checklist Template, copied onto the item) and
// whose Workflow's codes show a Screen holding the copied checklist. K1's Engineer answers it and
// photographs a failed item at the Consultant review Step, then Sends it to the Manager.
//
// RP-86-1: until the code, only K1 reads the answers and photos: neither C1 nor an Owner with
// oversight reads them, by list or by id, and none of them writes them. The code freezes and shares
// them: C1 and the Owner read them in its event, and the photo by id. C2, another Contractor not
// covering the Location, never reads them. Another Project's Member reads none. Leaving K1 any other way (a Send Back)
// discards them.
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, buildSeamTwoTower, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const TYPE = `WC${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const FIELD = "inspection_checklist";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const label = (en: string) => ({ en, ar: en });
const ANSWERS = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "pass" } };
/** The codes' Screen: the copied checklist and Remarks. */
const codeScreen = {
  sections: [
    {
      key: "inspection",
      title: label("Inspection"),
      fields: [
        { key: FIELD, type: "copied_checklist", copyOf: "checklist_template", label: label("Checklist"), required: true },
        { key: "remarks", type: "textarea", label: label("Remarks") },
      ],
    },
  ],
};

let migrator: pg.Client;
let app: Db;

// The Tower: C1 raises the Inspection; K1 inspects (its Engineer and Manager); OW is the Owner with oversight of
// everything (V2); C2 is another Contractor of the same Trade, covering Building B only (V3); `other` is
// another Project's Project Admin.
const towerOptions = { projectCode: "RCK", tradeCode: "CV", otherProject: true, k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;
let tower: Tower;
let c1: Tower["c1"];
let k1: Tower["k1"];
let ow: Tower["ow"];
let c2: Tower["c2"];
let other: Tower["other"];
let c1Pm = "";
let call: Tower["call"];
let outcome: Tower["outcome"];
let take: Tower["take"];
let pickUp: Tower["pickUp"];

const run = (text: string) => migrator.query(text);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
const save = (as: string, id: string, answers: object = ANSWERS) =>
  outcome(as, sql`select app.save_reply_checklist(${id}::uuid, ${FIELD}, ${JSON.stringify(answers)}::jsonb, now()) as outcome`);
const startPhoto = (as: string, id: string, item: string) =>
  call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, ${FIELD}, ${item}, 'gap.jpg', 1024, 'image/jpeg', now())`,
  ).then((rows) => rows[0]!);

/** `as` photographs check item `item` of Inspection `id`: started and confirmed, as the api does once the file is stored. */
async function addPhoto(as: string, id: string, item = "formwork"): Promise<string> {
  const started = await startPhoto(as, id, item);
  expect(started.outcome).toBe("started");
  const confirmed = await outcome(
    as,
    sql`select app.confirm_document_upload(${id}::uuid, ${started.document_id}::uuid, 1024, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
  );
  expect(confirmed).toBe("confirmed");
  return started.document_id;
}

const startCopy = (as: string, id: string, original: string) =>
  call<{ outcome: string; document_id: string | null }>(
    as,
    sql`select outcome, document_id from app.start_annotated_copy_upload(${id}::uuid, ${original}::uuid, 'gap-annotated.jpg', 2048, 'image/jpeg', now())`,
  ).then((rows) => rows[0]!);

/** `as` saves an annotated copy of photo `original` of Inspection `id` (RP-656's tool): started and confirmed. */
async function annotate(as: string, id: string, original: string): Promise<string> {
  const started = await startCopy(as, id, original);
  expect(started.outcome).toBe("started");
  const confirmed = await outcome(
    as,
    sql`select app.confirm_document_upload(${id}::uuid, ${started.document_id}::uuid, 2048, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
  );
  expect(confirmed).toBe("confirmed");
  return started.document_id!;
}

/** The answers `as` reads of Inspection `id`'s checklist before its code. */
const answersAs = (as: string, id: string) =>
  call<{ field_key: string; answers: unknown }>(as, sql`select field_key, answers from reply_checklist where work_item_id = ${id}::uuid`);
/** The ids of Inspection `id`'s checklist photos `as` reads: every row, then one by its id. */
const photosAs = async (as: string, id: string) =>
  (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${id}::uuid and field_key = ${FIELD} order by id`)).map((r) => r.id);
const byId = async (as: string, documentId: string) =>
  (await call<{ id: string }>(as, sql`select id from document where id = ${documentId}::uuid`)).map((r) => r.id);
/** The checklist the code's event shares, as `as` reads its events. */
const codeAnswersAs = async (as: string, id: string) =>
  (
    await call<{ checklist: unknown }>(
      as,
      sql`select payload -> ${FIELD} as checklist from work_item_event where work_item_id = ${id}::uuid and type in ('transition', 'issue_code') and transition_id is not null and payload ? ${FIELD}`,
    )
  ).map((r) => r.checklist);

/** C1's Inspection, Submitted to K1 and picked up by K1's Engineer at Consultant review, its checklist copied. */
const atConsultantReview = (title: string) => wirAtConsultant(tower, { type: TYPE, title });

/** At Consultant approval: K1's Engineer answered and photographed the checklist, and Sent it to the Manager, who picked it up. */
async function atManager(title: string): Promise<{ id: string; photo: string }> {
  const id = await atConsultantReview(title);
  expect(await save(k1.members.engineer, id)).toBe("saved");
  const photo = await addPhoto(k1.members.engineer, id);
  expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1.members.manager, id)).toBe("picked_up");
  return { id, photo };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });

  // The test Type: the WIR Form document, on a test Workflow whose codes show the checklist's
  // Screen, with a Send Back from Consultant review (the WIR's own Workflow has none).
  const screenVersion = await addTestScreen(run, `rp86_${digits(6)}`, codeScreen, []);
  const workflowId = await addTestWorkflow(run, {
    name: label(`RP-86 checklist ${digits(6)}`),
    recommendCode: true,
    screens: { approve_a: screenVersion, revise_c: screenVersion },
  });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(label("Inspection (RP-86)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    wirForm,
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(label("Inspection (RP-86)")), workflowId, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  ({ c1, k1, ow, c2, other, call, outcome, take, pickUp } = tower);
  c1Pm = c1.members.project_manager;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-86-1: the Consultant Engineer's checklist stays with K1 until the code (V19)", () => {
  it("before the code, C1 and the Owner read none of the answers or photos, by list or by id; both K1 Members do", async () => {
    const { id, photo } = await atManager("Slab pour, Level 2");

    for (const reader of [k1.members.engineer, k1.members.manager]) {
      expect(await answersAs(reader, id), reader).toEqual([{ field_key: FIELD, answers: ANSWERS }]);
      expect(await photosAs(reader, id), reader).toEqual([photo]);
      expect(await byId(reader, photo), reader).toEqual([photo]);
    }
    for (const outsider of [c1.members.engineer, c1Pm, ow.members.representative]) {
      // Each sees the Inspection itself (raised, oversight), never the checklist in progress.
      expect((await call<{ id: string }>(outsider, sql`select id from work_item where id = ${id}::uuid`)).length, outsider).toBe(1);
      expect(await answersAs(outsider, id), outsider).toEqual([]);
      expect(await photosAs(outsider, id), outsider).toEqual([]);
      expect(await byId(outsider, photo), outsider).toEqual([]);
      expect(await codeAnswersAs(outsider, id), outsider).toEqual([]);
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`), outsider).toEqual([]);
    }
  });

  it("another Project's Member reads and writes none of them (layer 1)", async () => {
    const { id, photo } = await atManager("Slab pour, Level 6");
    expect(await answersAs(other.ap, id)).toEqual([]);
    expect(await photosAs(other.ap, id)).toEqual([]);
    expect(await byId(other.ap, photo)).toEqual([]);
    expect(await save(other.ap, id)).toBe("not_found");
    expect((await startPhoto(other.ap, id, "cover")).outcome).toBe("not_found");
  });

  it("only the Engineer's Step writes them: not the Manager reading them at the code, and nobody outside K1", async () => {
    const { id } = await atManager("Slab pour, Level 3");
    expect(await save(k1.members.manager, id, { cover: { answer: "fail" } })).toBe("field_not_found");
    expect((await startPhoto(k1.members.manager, id, "cover")).outcome).toBe("field_not_found");
    for (const outsider of [c1.members.engineer, c1Pm, ow.members.representative]) {
      expect(await save(outsider, id), outsider).toBe("not_editable");
      expect((await startPhoto(outsider, id, "cover")).outcome, outsider).toBe("not_editable");
    }
    expect(await save(c2.members.engineer, id)).toBe("not_found");
    expect((await startPhoto(c2.members.engineer, id, "cover")).outcome).toBe("not_found");
    expect(await answersAs(k1.members.engineer, id)).toEqual([{ field_key: FIELD, answers: ANSWERS }]);

    // Returned to the Engineer, it keeps them, and the Engineer changes one.
    expect(await take(k1.members.manager, id, "return_to_engineer")).toBe("applied");
    expect(await pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await answersAs(k1.members.engineer, id)).toEqual([{ field_key: FIELD, answers: ANSWERS }]);
    const changed = { ...ANSWERS, cover: { answer: "na" } };
    expect(await save(k1.members.engineer, id, changed)).toBe("saved");
    expect(await answersAs(k1.members.manager, id)).toEqual([{ field_key: FIELD, answers: changed }]);
  });

  it("an item that is no check item, or one taking no photos, is refused a photo", async () => {
    const id = await atConsultantReview("Slab pour, Level 4");
    expect((await startPhoto(k1.members.engineer, id, "made_up")).outcome).toBe("field_not_found");
    expect((await startPhoto(k1.members.engineer, id, "formwork")).outcome).toBe("started");
  });

  it("the code freezes and shares them: C1 and the Owner read them in its event, and the photo by id; C2 never", async () => {
    const { id, photo } = await atManager("Slab pour, Level 5");
    expect(await answersAs(c2.members.engineer, id)).toEqual([]);
    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");

    for (const reader of [c1.members.engineer, c1Pm, ow.members.representative, k1.members.engineer, k1.members.manager]) {
      expect(await codeAnswersAs(reader, id), reader).toEqual([ANSWERS]);
      expect(await photosAs(reader, id), reader).toEqual([photo]);
      expect(await byId(reader, photo), reader).toEqual([photo]);
      // Taken: none waits any more.
      expect(await answersAs(reader, id), reader).toEqual([]);
    }
    const [frozen] = await call<{ frozen: boolean; taken: boolean }>(
      c1.members.engineer,
      sql`select frozen_at is not null as frozen, reply_event_id is not null as taken from document where id = ${photo}::uuid`,
    );
    expect(frozen).toEqual({ frozen: true, taken: true });
    expect(await codeAnswersAs(c2.members.engineer, id)).toEqual([]);
    expect(await photosAs(c2.members.engineer, id)).toEqual([]);
    expect(await byId(c2.members.engineer, photo)).toEqual([]);
  });
});

// A cancel is refused once an item is Submitted (app.cancel_allowed), so it never meets a checklist
// filled after the Submit; closing discards one all the same (work_item_discards_reply_files).
describe("leaving K1 any other way discards them", () => {
  it("a Send Back: the answers and photos are gone, for K1 too, and the item comes back to K1 with an empty checklist", async () => {
    const id = await atConsultantReview("Slab pour, sent back");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    expect(await take(k1.members.engineer, id, "send_back")).toBe("applied");
    for (const reader of [k1.members.engineer, c1.members.engineer, c1Pm]) {
      expect(await answersAs(reader, id), reader).toEqual([]);
      expect(await photosAs(reader, id), reader).toEqual([]);
      expect(await codeAnswersAs(reader, id), reader).toEqual([]);
    }
    const left = await migrator.query("select count(*)::integer as n from reply_checklist where work_item_id = $1", [id]);
    expect(left.rows[0].n).toBe(0);
    const removed = await migrator.query("select removed_at is not null as removed from document where id = $1", [photo]);
    expect(removed.rows[0].removed).toBe(true);
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await answersAs(k1.members.engineer, id)).toEqual([]);
    expect(await photosAs(k1.members.engineer, id)).toEqual([]);
  });
});

// RP-981 (INSP-12): the Engineer annotates a checklist item's photo with RP-656's tool. The
// annotated copy is a reply Document of the same field and check item, never a Form Document, so
// it is K1's until the code exactly as its original is (V19, ADR 0024).
describe("RP-981-1: an annotated copy of a checklist photo stays with K1 until the code", () => {
  it("the Engineer annotates the photo before Send to Manager: a reply Document in the photo's field and item, which the Manager reads beside it", async () => {
    const id = await atConsultantReview("Slab pour, annotated");
    expect(await save(k1.member, id)).toBe("saved");
    const photo = await addPhoto(k1.member, id);
    const copy = await annotate(k1.member, id, photo);

    const rows = await migrator.query("select id, reply, field_key, item_key, annotated_from_id from document where id = $1", [copy]);
    expect(rows.rows).toEqual([{ id: copy, reply: true, field_key: FIELD, item_key: "formwork", annotated_from_id: photo }]);
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1Manager, id)).toBe("picked_up");
    expect(await photosAs(k1Manager, id)).toEqual([photo, copy].sort());
  });

  it("before the code, C1, the Owner and C2 read neither the original nor the copy; the code freezes and shares both, never to C2", async () => {
    const id = await atConsultantReview("Slab pour, annotated and coded");
    expect(await save(k1.member, id)).toBe("saved");
    const photo = await addPhoto(k1.member, id);
    const copy = await annotate(k1.member, id, photo);
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1Manager, id)).toBe("picked_up");

    for (const outsider of [c1.member, c1Pm, ow.member, c2.member, other.ap]) {
      expect(await photosAs(outsider, id), outsider).toEqual([]);
      for (const document of [photo, copy]) expect(await byId(outsider, document), outsider).toEqual([]);
    }
    for (const outsider of [c1.member, c1Pm, ow.member]) {
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`), outsider).toEqual([]);
    }

    expect(await take(k1Manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    for (const reader of [c1.member, c1Pm, ow.member, k1.member, k1Manager]) {
      expect(await photosAs(reader, id), reader).toEqual([photo, copy].sort());
      expect(await byId(reader, copy), reader).toEqual([copy]);
    }
    const taken = await migrator.query(
      "select id, frozen_at is not null as frozen, reply_event_id is not null as taken from document where work_item_id = $1 order by id",
      [id],
    );
    expect(taken.rows).toEqual([photo, copy].sort().map((d) => ({ id: d, frozen: true, taken: true })));
    for (const outsider of [c2.member, other.ap]) {
      expect(await photosAs(outsider, id), outsider).toEqual([]);
      expect(await byId(outsider, copy), outsider).toEqual([]);
    }
    // Shared: K1 holds the WIR no more, so it is never annotated again.
    expect((await startCopy(k1Manager, id, photo)).outcome).toBe("not_editable");
  });

  it("only who may add to the field now annotates: not the Manager at the code, and nobody outside K1, who doesn't even read the photo", async () => {
    const id = await atConsultantReview("Slab pour, who annotates");
    expect(await save(k1.member, id)).toBe("saved");
    const photo = await addPhoto(k1.member, id);
    // K1's Manager may too: any Member of the Participant holding the Step (ADR 0024).
    await annotate(k1Manager, id, photo);
    for (const outsider of [c1.member, c1Pm, ow.member, c2.member, other.ap]) {
      expect((await startCopy(outsider, id, photo)).outcome, outsider).toBe("not_found");
    }
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1Manager, id)).toBe("picked_up");
    expect((await startCopy(k1Manager, id, photo)).outcome).toBe("field_not_found");
  });

  it("a Send Back before the code removes the copy with its original, for K1 too", async () => {
    const id = await atConsultantReview("Slab pour, annotated and sent back");
    expect(await save(k1.member, id)).toBe("saved");
    const photo = await addPhoto(k1.member, id);
    const copy = await annotate(k1.member, id, photo);
    expect(await take(k1.member, id, "send_back")).toBe("applied");
    for (const reader of [k1.member, c1.member, c1Pm]) expect(await photosAs(reader, id), reader).toEqual([]);
    const removed = await migrator.query("select removed_at is not null as removed from document where id = $1", [copy]);
    expect(removed.rows[0].removed).toBe(true);
  });

  it("a copy started before a Transition took its original is never confirmed", async () => {
    const id = await atConsultantReview("Slab pour, original taken first");
    const photo = await addPhoto(k1.member, id);
    const started = await startCopy(k1.member, id, photo);
    expect(started.outcome).toBe("started");
    // As a Transition that leaves the item with K1 and its field open would leave it (none of the Rabaed Defaults does).
    await migrator.query("update document set frozen_at = now() where id = $1", [photo]);
    expect(
      await outcome(
        k1.member,
        sql`select app.confirm_document_upload(${id}::uuid, ${started.document_id}::uuid, 2048, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
      ),
    ).toBe("not_editable");
  });

  it("a copy doesn't count toward the check item's 10 photos", async () => {
    const id = await atConsultantReview("Slab pour, ten photos");
    const photos = [];
    for (let n = 0; n < 10; n++) photos.push(await addPhoto(k1.member, id));
    expect((await startPhoto(k1.member, id, "formwork")).outcome).toBe("too_many_files");
    await annotate(k1.member, id, photos[0]!);
  });

  it("is never written as a Form Document, nor anywhere but its original's field and check item", async () => {
    const id = await atConsultantReview("Slab pour, never a Form Document");
    const photo = await addPhoto(k1.member, id);
    const copy = await annotate(k1.member, id, photo);
    for (const [column, value] of [
      ["reply", false],
      ["field_key", "remarks"],
      ["item_key", "cover"],
    ] as const) {
      await expect(migrator.query(`update document set ${column} = $1 where id = $2`, [value, copy]), column).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      migrator.query(
        `insert into document (project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
           uploaded_by_member_id, uploaded_by_participant_id, field_key, item_key, annotated_from_id)
         select project_id, work_item_id, 'leak.jpg', 1, 'image/jpeg', storage_key || '-leak', uploaded_by_member_id,
           uploaded_by_participant_id, field_key, item_key, id
         from document where id = $1`,
        [photo],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
