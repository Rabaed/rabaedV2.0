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
//
// RP-577-1: the Snag a code raises from a failed item is seen where the Inspection is, never by C2.
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `WC${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const FIELD = "inspection_checklist";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const ANSWERS = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "pass" } };
/** The codes' Screen: the copied checklist and Remarks. */
const codeScreen = {
  sections: [
    {
      key: "inspection",
      title: bilingual("Inspection"),
      fields: [
        { key: FIELD, type: "copied_checklist", copyOf: "checklist_template", label: bilingual("Checklist"), required: true },
        { key: "remarks", type: "textarea", label: bilingual("Remarks") },
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
const rowsOf = (ids: string[]) => ids.map((id) => ({ id }));
/** Photo `photo` of item `id` is read by each of `seenBy` first, in the list and by id, then by none of `hiddenFrom` (RP-1095). */
async function photoHidden(id: string, photo: string, seenBy: string | string[], hiddenFrom: string | string[], label: string) {
  await expectHiddenFrom({ read: async (as: string) => rowsOf(await photosAs(as, id)), target: photo, seenBy, hiddenFrom, label: `${label}, the list` });
  await expectHiddenFrom({ read: async (as: string) => rowsOf(await byId(as, photo)), target: photo, seenBy, hiddenFrom, label: `${label}, by id` });
}
/** Item `id`'s checklist answers are read by each of `seenBy` first, then by none of `hiddenFrom` (RP-1095). */
const answersHidden = (id: string, seenBy: string | string[], hiddenFrom: string | string[], label: string) =>
  expectHiddenFrom({ read: (as: string) => answersAs(as, id), target: FIELD, idOf: (r) => r.field_key, seenBy, hiddenFrom, label: `${label}, the answers` });
/** The Documents item `id`'s shared events took, by id, as `as` reads them. */
const sharedDocuments = async (as: string, id: string) =>
  call<{ id: string }>(as, sql`select d as id from app.work_item_shared_documents(${id}::uuid) d`);

/** The checklist the code's event shares, as `as` reads its events. */
const codeAnswersAs = async (as: string, id: string) =>
  (
    await call<{ checklist: unknown }>(
      as,
      sql`select payload -> ${FIELD} as checklist from work_item_event where work_item_id = ${id}::uuid and type in ('transition', 'issue_code') and payload ? ${FIELD}`,
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
    name: bilingual(`RP-86 checklist ${digits(6)}`),
    recommendCode: true,
    screens: { approve_a: screenVersion, revise_c: screenVersion },
  });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-86)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    wirForm,
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-86)")), workflowId, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  ({ c1, k1, ow, c2, other, call, outcome, take, pickUp } = tower);
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
    const outsiders = [c1.members.engineer, c1.members.project_manager, ow.members.representative];
    for (const outsider of outsiders) {
      // Each sees the Inspection itself (raised, oversight), never the checklist in progress.
      expect((await call<{ id: string }>(outsider, sql`select id from work_item where id = ${id}::uuid`)).map((r) => r.id), outsider).toEqual([id]);
      expect(await codeAnswersAs(outsider, id), outsider).toEqual([]);
    }
    await answersHidden(id, k1.members.engineer, outsiders, "before the code");
    await photoHidden(id, photo, [k1.members.engineer, k1.members.manager], outsiders, "before the code");
    // (No shared event has taken a Document yet, so app.work_item_shared_documents is empty for everyone
    // here; the code's test below reads it shared.)
  });

  it("another Project's Member reads and writes none of them (layer 1)", async () => {
    const { id, photo } = await atManager("Slab pour, Level 6");
    await answersHidden(id, k1.members.engineer, other.ap, "another Project");
    await photoHidden(id, photo, k1.members.engineer, other.ap, "another Project");
    expect(await save(other.ap, id)).toBe("not_found");
    expect((await startPhoto(other.ap, id, "cover")).outcome).toBe("not_found");
  });

  it("only the Engineer's Step writes them: not the Manager reading them at the code, and nobody outside K1", async () => {
    const { id } = await atManager("Slab pour, Level 3");
    expect(await save(k1.members.manager, id, { cover: { answer: "fail" } })).toBe("field_not_found");
    expect((await startPhoto(k1.members.manager, id, "cover")).outcome).toBe("field_not_found");
    for (const outsider of [c1.members.engineer, c1.members.project_manager, ow.members.representative]) {
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
    await answersHidden(id, k1.members.engineer, c2.members.engineer, "before the code");
    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");

    for (const reader of [c1.members.engineer, c1.members.project_manager, ow.members.representative, k1.members.engineer, k1.members.manager]) {
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
    await photoHidden(id, photo, c1.members.engineer, c2.members.engineer, "after the code");
    await expectHiddenFrom({
      read: (as: string) => sharedDocuments(as, id),
      target: photo,
      seenBy: [c1.members.engineer, ow.members.representative],
      hiddenFrom: c2.members.engineer,
      label: "the code's shared Documents",
    });
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
    for (const reader of [k1.members.engineer, c1.members.engineer, c1.members.project_manager]) {
      expect(await answersAs(reader, id), reader).toEqual([]);
      expect(await photosAs(reader, id), reader).toEqual([]);
      expect(await codeAnswersAs(reader, id), reader).toEqual([]);
    }
    const left = await migrator.query("select count(*)::integer as n from reply_checklist where work_item_id = $1", [id]);
    expect(left.rows[0].n).toBe(0);
    const removed = await migrator.query("select removed_at is not null as removed from document where id = $1", [photo]);
    expect(removed.rows[0].removed).toBe(true);
    expect(await pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await take(c1.members.project_manager, id, "submit")).toBe("applied");
    expect(await pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await answersAs(k1.members.engineer, id)).toEqual([]);
    expect(await photosAs(k1.members.engineer, id)).toEqual([]);
  });
});

// RP-577-1 (visibility.md): the code raises a Snag from each failed item still ticked "Raise a
// Snag" (`formwork` here; `cover` raises none). The Snag is seen exactly where the Inspection is:
// C1 (it holds it), K1 (it raised it) and the Owner (oversight), never C2, another Contractor of the
// same Trade not covering the Location (V3), nor another Project's Member: not the Snag, its photos,
// its check item, its count, nor its files to copy. Its history starts with the Raise, shared, by K1.
describe("RP-577-1: the Snags a code raises are seen where the Inspection is", () => {
  let id = "";
  let snag = "";

  beforeAll(async () => {
    ({ id } = await atManager("Slab pour, Level 7"));
    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    const raised = await migrator.query("select from_id from work_item_link where to_id = $1 and kind = 'raised_from'", [id]);
    expect(raised.rows).toHaveLength(1);
    snag = raised.rows[0].from_id as string;
  });

  const snagRow = (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${snag}::uuid`);
  const seesSnag = async (as: string) => (await snagRow(as)).map((r) => r.id).includes(snag);
  /** The Snag's photos `as` reads, by id. */
  const snagPhotos = async (as: string) => (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${snag}::uuid order by id`)).map((r) => r.id);
  /** The Snag's photos, as the owner reads them: the ids every reader must get. */
  const storedPhotos = async () => (await migrator.query("select id from document where work_item_id = $1 order by id", [snag])).rows.map((r) => r.id as string);
  const snagCount = (as: string) =>
    call<{ type_code: string; open_count: number }>(as, sql`select type_code, open_count::integer from app.work_item_raised_item_counts(${id}::uuid)`);
  const checkItem = async (as: string) =>
    (await call<{ item: unknown }>(as, sql`select app.raised_from_check_item(${snag}::uuid) as item`))[0]!.item;
  /** The Snag's "Raised from" source, as `as` reads its Links. */
  const source = (as: string) =>
    call<{ document_number: string; work_item_id: string }>(as, sql`select document_number, work_item_id from app.work_item_links(${snag}::uuid) where kind = 'raised_from'`);

  it("C1, K1 and the Owner read the Snag, its photo, its check item, its source and its count", async () => {
    const number = (await migrator.query("select document_number from work_item where id = $1", [id])).rows[0].document_number as string;
    const photos = await storedPhotos();
    expect(photos.length).toBe(1); // not hidden-from: the owner's own count of the copies
    for (const reader of [c1.members.engineer, c1.members.project_manager, k1.members.engineer, k1.members.manager, ow.members.representative]) {
      expect(await seesSnag(reader), reader).toBe(true);
      expect(await snagPhotos(reader), reader).toEqual(photos);
      expect(await checkItem(reader), reader).toEqual({ key: "formwork", text: bilingual("Formwork tight") });
      // Not only C1, holding it: the Link came with the Snag, before its first arrival (RP-1031).
      expect(await source(reader), reader).toEqual([{ document_number: number, work_item_id: id }]);
      expect(await snagCount(reader), reader).toEqual([{ type_code: "SNG", open_count: 1 }]);
    }
  });

  it("C2 and another Project's Member read none of it", async () => {
    // Each read first by C1's engineer, who sees it, then by neither outsider (RP-1095).
    const seenBy = c1.members.engineer;
    const hiddenFrom = [c2.members.engineer, other.ap];
    await expectHiddenFrom({ read: snagRow, target: snag, seenBy, hiddenFrom, label: "the Snag" });
    const [photo] = await storedPhotos();
    await expectHiddenFrom({ read: async (as: string) => rowsOf(await snagPhotos(as)), target: photo!, seenBy, hiddenFrom, label: "its photo" });
    await expectHiddenFrom({ read: async (as: string) => ((await checkItem(as)) === null ? [] : [{ id: "formwork" }]), target: "formwork", seenBy, hiddenFrom, label: "its check item" });
    await expectHiddenFrom({ read: source, target: id, idOf: (r) => r.work_item_id, seenBy, hiddenFrom, label: "its source" });
    await expectHiddenFrom({ read: snagCount, target: "SNG", idOf: (r) => r.type_code, seenBy, hiddenFrom, label: "its count" });
    // (app.raised_document_copies gives nothing to anyone once the code has committed, the next test shows,
    // so an outsider's empty read of it would prove nothing: RP-1095.)
  });

  it("the tick, taken off before the code, is K1's alone like the answers (V19), and the code shares it", async () => {
    const unticked = { ...ANSWERS, formwork: { ...ANSWERS.formwork, snag: false } };
    const held = await atConsultantReview("Slab pour, unticked");
    expect(await save(k1.members.engineer, held, unticked)).toBe("saved");
    expect(await answersAs(k1.members.manager, held)).toEqual([{ field_key: FIELD, answers: unticked }]);
    for (const outsider of [c1.members.engineer, c1.members.project_manager, ow.members.representative, c2.members.engineer, other.ap]) {
      expect(await answersAs(outsider, held), outsider).toEqual([]);
    }
    await addPhoto(k1.members.engineer, held);
    expect(await take(k1.members.engineer, held, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.members.manager, held)).toBe("picked_up");
    expect(await take(k1.members.manager, held, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    expect(await codeAnswersAs(c1.members.engineer, held)).toEqual([unticked]);
    const raised = await migrator.query("select 1 from work_item_link where to_id = $1 and kind = 'raised_from'", [held]);
    expect(raised.rows).toEqual([]);
  });

  it("the files to copy are only the code's own transaction's: once it committed, none, for K1 that raised them too", async () => {
    // The photo was copied (a Document of the Snag) ...
    expect(await snagPhotos(k1.members.manager)).toEqual(await storedPhotos());
    // ... but a later transaction (a replayed code) is given nothing to copy again.
    for (const reader of [k1.members.manager, c1.members.engineer]) {
      expect(await call(reader, sql<object>`select * from app.raised_document_copies(${id}::uuid)`), reader).toEqual([]);
    }
  });

  it("its history starts with the Raise, shared, by K1; it is held by C1", async () => {
    const [raise] = await call<{ type: string; audience: string; company_name: unknown }>(
      c1.members.engineer,
      sql`select type, audience, company_name from app.work_item_history(${snag}::uuid) order by seq limit 1`,
    );
    expect(raise).toEqual({ type: "transition", audience: "shared", company_name: bilingual("K1") });
    const held = await migrator.query("select participant_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [snag]);
    expect(held.rows.map((r) => r.participant_id)).toEqual([c1.participantId]);
  });
});

// RP-1078: the check item's text is the Inspection's, so app.raised_from_check_item gives it only to
// a reader who sees the Inspection too, and only through a Link not taken away. Today the Snag copies
// the Inspection's readers and the Link is never removed; these hold the rule in the database on its
// own. The migrator makes each case: the Owner's oversight row taken off the Inspection alone (as when
// the Snag's built-ins changed), then the Link marked removed.
describe("RP-1078: a Snag's check item is read only by those who see its Inspection, through a Link not removed", () => {
  let id = "";
  let snag = "";
  const formwork = { key: "formwork", text: bilingual("Formwork tight") };
  const checkItem = async (as: string) =>
    (await call<{ item: unknown }>(as, sql`select app.raised_from_check_item(${snag}::uuid) as item`))[0]!.item;
  const sees = async (as: string, item: string) => (await call<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`)).length === 1;

  beforeAll(async () => {
    ({ id } = await atManager("Slab pour, Level 9"));
    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    const raised = await migrator.query("select from_id from work_item_link where to_id = $1 and kind = 'raised_from'", [id]);
    snag = raised.rows[0].from_id as string;
  });

  it("is null to the Owner once it sees the Snag but not the Inspection; C1 still reads it", async () => {
    const owner = ow.members.representative;
    expect(await checkItem(owner)).toEqual(formwork);
    await migrator.query("delete from work_item_access where work_item_id = $1 and participant_id = $2", [id, ow.participantId]);
    expect(await sees(owner, snag)).toBe(true);
    expect(await sees(owner, id)).toBe(false);
    expect(await checkItem(owner)).toBeNull();
    // Positive control: C1 sees both and reads it.
    expect(await checkItem(c1.members.engineer)).toEqual(formwork);
  });

  it("is null to everyone once the Link is removed", async () => {
    await migrator.query("update work_item_link set removed_at = now() where from_id = $1 and kind = 'raised_from'", [snag]);
    for (const reader of [c1.members.engineer, k1.members.manager]) {
      expect(await sees(reader, snag), reader).toBe(true);
      expect(await sees(reader, id), reader).toBe(true);
      expect(await checkItem(reader), reader).toBeNull();
    }
  });
});

// RP-1081 (story 32 of spec RP-649): the Snag's "Raised from" card shows the failed check item's
// photos. app.raised_from_check_item_photos names them: the Inspection's Documents the code's
// shared event took for that item (the originals of the Snag's copied "before" photos, an annotated
// copy too), never another item's, and only to a reader who sees both the Snag and the Inspection,
// through a Link not removed. The reader then reads each one through the documents policy.
describe("RP-1081-1: a Snag's check item photos are the Inspection's, read where the Inspection is", () => {
  let id = "";
  let snag = "";
  let item: string[] = [];
  /** The check item photos `as` reads: the ids the function names, read through the documents policy. */
  const photos = async (as: string) =>
    (
      await call<{ id: string }>(
        as,
        sql`select d.id from document d where d.id in (select document_id from app.raised_from_check_item_photos(${snag}::uuid)) order by d.id`,
      )
    ).map((r) => r.id);
  /** The photo ids app.raised_from_check_item_photos names to `as`. */
  const named = async (as: string) => (await call<{ document_id: string }>(as, sql`select document_id from app.raised_from_check_item_photos(${snag}::uuid)`)).map((r) => ({ id: r.document_id }));

  beforeAll(async () => {
    id = await atConsultantReview("Slab pour, Level 11");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    const copy = await annotate(k1.members.engineer, id, photo);
    // A photo of another item (`cover`, passed): no Snag of its own, never on this one's card.
    await addPhoto(k1.members.engineer, id, "cover");
    expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    const raised = await migrator.query("select from_id from work_item_link where to_id = $1 and kind = 'raised_from'", [id]);
    snag = raised.rows[0].from_id as string;
    item = [photo, copy].sort();
  });

  it("C1, K1 and the Owner read the failed item's photos, its annotated copy too, never the passed item's", async () => {
    for (const reader of [c1.members.engineer, c1.members.project_manager, k1.members.engineer, k1.members.manager, ow.members.representative]) {
      expect(await photos(reader), reader).toEqual(item);
    }
  });

  it("C2 and another Project's Member are named none", async () => {
    // Each photo is named to C1's engineer first (RP-1095).
    for (const target of item) {
      await expectHiddenFrom({ read: named, target, seenBy: c1.members.engineer, hiddenFrom: [c2.members.engineer, other.ap], label: "check item photos" });
    }
  });

  it("names none to the Owner once it sees the Snag but not the Inspection, and none to anyone once the Link is removed", async () => {
    const owner = ow.members.representative;
    await migrator.query("delete from work_item_access where work_item_id = $1 and participant_id = $2", [id, ow.participantId]);
    for (const target of item) await expectHiddenFrom({ read: named, target, seenBy: [c1.members.engineer, k1.members.manager], hiddenFrom: owner, label: "no Inspection" });
    expect(await photos(c1.members.engineer)).toEqual(item);
    await migrator.query("update work_item_link set removed_at = now() where from_id = $1 and kind = 'raised_from'", [snag]);
    // Both were named them just above; now neither is.
    for (const reader of [c1.members.engineer, k1.members.manager]) {
      expect(await named(reader), reader).toEqual([]);
    }
  });
});

// RP-981 (INSP-12): the Engineer annotates a checklist item's photo with RP-656's tool. The
// annotated copy is a reply Document of the same field and check item, never a Form Document, so
// it is K1's until the code exactly as its original is (V19, ADR 0024).
describe("RP-981-1: an annotated copy of a checklist photo stays with K1 until the code", () => {
  it("the Engineer annotates the photo before Send to Manager: a reply Document in the photo's field and item, which the Manager reads beside it", async () => {
    const id = await atConsultantReview("Slab pour, annotated");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    const copy = await annotate(k1.members.engineer, id, photo);

    const rows = await migrator.query("select id, reply, field_key, item_key, annotated_from_id from document where id = $1", [copy]);
    expect(rows.rows).toEqual([{ id: copy, reply: true, field_key: FIELD, item_key: "formwork", annotated_from_id: photo }]);
    expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await photosAs(k1.members.manager, id)).toEqual([photo, copy].sort());
  });

  it("before the code, C1, the Owner and C2 read neither the original nor the copy; the code freezes and shares both, never to C2", async () => {
    const id = await atConsultantReview("Slab pour, annotated and coded");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    const copy = await annotate(k1.members.engineer, id, photo);
    expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.members.manager, id)).toBe("picked_up");

    const outsiders = [c1.members.engineer, c1.members.project_manager, ow.members.representative, c2.members.engineer, other.ap];
    for (const document of [photo, copy]) await photoHidden(id, document, k1.members.engineer, outsiders, "before the code");
    // (No shared event has taken them yet, so app.work_item_shared_documents is empty for everyone here.)

    expect(await take(k1.members.manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");
    for (const reader of [c1.members.engineer, c1.members.project_manager, ow.members.representative, k1.members.engineer, k1.members.manager]) {
      expect(await photosAs(reader, id), reader).toEqual([photo, copy].sort());
      expect(await byId(reader, copy), reader).toEqual([copy]);
    }
    const taken = await migrator.query(
      "select id, frozen_at is not null as frozen, reply_event_id is not null as taken from document where work_item_id = $1 order by id",
      [id],
    );
    expect(taken.rows).toEqual([photo, copy].sort().map((d) => ({ id: d, frozen: true, taken: true })));
    await photoHidden(id, copy, c1.members.engineer, [c2.members.engineer, other.ap], "after the code");
    // Shared: K1 holds the WIR no more, so it is never annotated again.
    expect((await startCopy(k1.members.manager, id, photo)).outcome).toBe("not_editable");
  });

  it("only who may add to the field now annotates: not the Manager at the code, and nobody outside K1, who doesn't even read the photo", async () => {
    const id = await atConsultantReview("Slab pour, who annotates");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    // K1's Manager may too: any Member of the Participant holding the Step (ADR 0024).
    await annotate(k1.members.manager, id, photo);
    for (const outsider of [c1.members.engineer, c1.members.project_manager, ow.members.representative, c2.members.engineer, other.ap]) {
      expect((await startCopy(outsider, id, photo)).outcome, outsider).toBe("not_found");
    }
    expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.members.manager, id)).toBe("picked_up");
    expect((await startCopy(k1.members.manager, id, photo)).outcome).toBe("field_not_found");
  });

  it("a Send Back before the code removes the copy with its original, for K1 too", async () => {
    const id = await atConsultantReview("Slab pour, annotated and sent back");
    expect(await save(k1.members.engineer, id)).toBe("saved");
    const photo = await addPhoto(k1.members.engineer, id);
    const copy = await annotate(k1.members.engineer, id, photo);
    expect(await take(k1.members.engineer, id, "send_back")).toBe("applied");
    for (const reader of [k1.members.engineer, c1.members.engineer, c1.members.project_manager]) expect(await photosAs(reader, id), reader).toEqual([]);
    const removed = await migrator.query("select removed_at is not null as removed from document where id = $1", [copy]);
    expect(removed.rows[0].removed).toBe(true);
  });

  it("a copy started before a Transition took its original is never confirmed", async () => {
    const id = await atConsultantReview("Slab pour, original taken first");
    const photo = await addPhoto(k1.members.engineer, id);
    const started = await startCopy(k1.members.engineer, id, photo);
    expect(started.outcome).toBe("started");
    // As a Transition that leaves the item with K1 and its field open would leave it (none of the Rabaed Defaults does).
    await migrator.query("update document set frozen_at = now() where id = $1", [photo]);
    expect(
      await outcome(
        k1.members.engineer,
        sql`select app.confirm_document_upload(${id}::uuid, ${started.document_id}::uuid, 2048, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
      ),
    ).toBe("not_editable");
  });

  it("a copy doesn't count toward the check item's 10 photos", async () => {
    const id = await atConsultantReview("Slab pour, ten photos");
    const photos = [];
    for (let n = 0; n < 10; n++) photos.push(await addPhoto(k1.members.engineer, id));
    expect((await startPhoto(k1.members.engineer, id, "formwork")).outcome).toBe("too_many_files");
    await annotate(k1.members.engineer, id, photos[0]!);
  });

  it("is never written as a Form Document, nor anywhere but its original's field and check item", async () => {
    const id = await atConsultantReview("Slab pour, never a Form Document");
    const photo = await addPhoto(k1.members.engineer, id);
    const copy = await annotate(k1.members.engineer, id, photo);
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
