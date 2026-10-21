// Seam 2 for a reply Screen's files (RP-623, SNAG-4; ADR 0024; visibility.md V19 and scenarios
// RP-623-1 to RP-623-3 and RP-1002-1), as the app role. K1, the Consultant, raises a Snag on C1; C1 adds
// After photos to the Resolve Screen's field while it works the Snag. Until the Resolve takes
// them only C1 reads them: neither K1 nor an Owner with oversight reads them, by list or by
// id, and C2, another Contractor of the same Trade covering another Location, never does.
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;

// The Tower: C1 works the Snag, K1 raises and verifies it, OW is the Owner with oversight (V2), and C2 is
// another Contractor of the same Trade, covering Building B only (V3).
let c1: SeamTwoTower["c1"];
let k1: SeamTwoTower["k1"];
let ow: SeamTwoTower["ow"];
let c2: SeamTwoTower["c2"];
let c1Pm = "";
let call: SeamTwoTower["call"];
let outcome: SeamTwoTower["outcome"];
let take: SeamTwoTower["take"];
let pickUp: SeamTwoTower["pickUp"];
let projectId = "";
let electrical = "";
let buildingA = "";

/** `as` adds an After photo to Snag `id`: started and confirmed, as the api does once the file is stored. */
async function addAfterPhoto(as: string, id: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'after.jpg', 1024, 'image/jpeg', now())`,
  );
  expect(started!.outcome).toBe("started");
  const confirmed = await outcome(
    as,
    sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 1024, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
  );
  expect(confirmed).toBe("confirmed");
  return started!.document_id;
}

/** The ids of item `id`'s After photos `as` reads: every row, then one by its id. */
const afterPhotos = async (as: string, id: string) =>
  (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${id}::uuid and field_key = 'after_photos' order by id`)).map(
    (r) => r.id,
  );
const byId = async (as: string, documentId: string) =>
  (await call<{ id: string }>(as, sql`select id from document where id = ${documentId}::uuid`)).map((r) => r.id);

/** K1's engineer's Snag, raised on C1, held by C1's PM at In Progress. */
async function inProgress(title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    k1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(k1.members.engineer, id, "raise")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "start_work")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  ({ c1, k1, ow, c2, call, outcome, take, pickUp, projectId, tradeId: electrical, buildingA } = await buildSeamTwoTower(app, migrator, {
    projectCode: "RFT",
    checklistTemplate: false,
  }));
  c1Pm = c1.members.project_manager;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Snag's After photos stay with C1 until its Resolve (V19)", () => {
  it("RP-623-1: before the Resolve, K1 and the Owner read none of C1's After photos, by list or by id; both C1 Members read them", async () => {
    const id = await inProgress("Cable tray not bonded");
    const photo = await addAfterPhoto(c1.members.engineer, id);
    // A move inside C1 keeps them with C1.
    expect(await take(c1Pm, id, "put_on_hold_in_progress")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");

    expect(await afterPhotos(c1Pm, id)).toEqual([photo]);
    expect(await afterPhotos(c1.members.engineer, id)).toEqual([photo]);
    for (const outsider of [k1.members.engineer, ow.members.representative]) {
      // Both see the Snag itself (raised, oversight), never its in-progress files.
      expect((await call<{ id: string }>(outsider, sql`select id from work_item where id = ${id}::uuid`)).length).toBe(1);
      expect(await afterPhotos(outsider, id)).toEqual([]);
      expect(await byId(outsider, photo)).toEqual([]);
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`)).toEqual([]);
    }
    // Nobody else adds one: K1 doesn't hold it.
    expect(
      (await call<{ outcome: string }>(k1.members.engineer, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'k1.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_editable");
  });

  it("RP-623-2: C2, another Contractor of the same Trade, reads them neither before nor after the Resolve", async () => {
    const id = await inProgress("Exposed rebar");
    const photo = await addAfterPhoto(c1Pm, id);
    expect(await afterPhotos(c2.members.engineer, id)).toEqual([]);
    expect(await byId(c2.members.engineer, photo)).toEqual([]);
    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Covered" })).toBe("applied");
    expect(await afterPhotos(c2.members.engineer, id)).toEqual([]);
    expect(await byId(c2.members.engineer, photo)).toEqual([]);
    expect(
      (await call<{ outcome: string }>(c2.members.engineer, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'c2.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_found");
  });

  it("RP-623-3: the Resolve shares them, frozen: K1 and the Owner read them, and C1 may add no more", async () => {
    const id = await inProgress("Corner to clean");
    const photo = await addAfterPhoto(c1Pm, id);
    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Cleaned" })).toBe("applied");
    for (const reader of [k1.members.engineer, ow.members.representative, c1.members.engineer]) {
      expect(await afterPhotos(reader, id)).toEqual([photo]);
      expect(await byId(reader, photo)).toEqual([photo]);
    }
    const [row] = await call<{ frozen: boolean; taken: boolean }>(
      k1.members.engineer,
      sql`select frozen_at is not null as frozen, reply_event_id is not null as taken from document where id = ${photo}::uuid`,
    );
    expect(row).toEqual({ frozen: true, taken: true });
    expect(
      (await call<{ outcome: string }>(c1Pm, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'late.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_editable");

    // K1 Returns it to Open: what C1 adds for its next Resolve is C1's alone again.
    expect(await take(k1.members.engineer, id, "return_to_open", { reason: "Still dusty" })).toBe("applied");
    const next = await addAfterPhoto(c1Pm, id);
    expect(await afterPhotos(c1.members.engineer, id)).toEqual([photo, next].sort());
    for (const outsider of [k1.members.engineer, ow.members.representative]) {
      expect(await afterPhotos(outsider, id)).toEqual([photo]);
      expect(await byId(outsider, next)).toEqual([]);
    }
  });
});

// The spec's own Testing Decision (RP-619), scenario RP-1002-1: an informed Consultant reads shared events
// only, never C1's in-progress After photos. C1 raises a Snag on itself (the Snag's Version 3 informs K1).
describe("an informed Consultant reads none of C1's After photos until its Resolve (RP-1002-1)", () => {
  it("RP-1002-1: C1 raises its own Snag, informing K1, and adds After photos at Open and In Progress: K1 reads none, by list, by id or shared, until the Resolve; then reads them frozen", async () => {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1Pm,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', 'Exposed cable', app.latest_form_version('SNG'), ${JSON.stringify({ description: "Exposed cable" })}::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    const id = created!.work_item_id;
    expect(await take(c1Pm, id, "raise")).toBe("applied");
    await pickUp(c1Pm, id);
    // K1 is informed: it reads the Snag itself.
    expect(await call(k1.members.engineer, sql<{ id: string }>`select id from work_item where id = ${id}::uuid`)).toEqual([{ id }]);
    const atOpen = await addAfterPhoto(c1Pm, id);
    expect(await take(c1Pm, id, "start_work")).toBe("applied");
    await pickUp(c1Pm, id);
    const inProgress = await addAfterPhoto(c1.members.engineer, id);

    const outsiders = [k1.members.engineer, ow.members.representative];
    for (const outsider of outsiders) {
      expect(await afterPhotos(outsider, id)).toEqual([]);
      for (const photo of [atOpen, inProgress]) expect(await byId(outsider, photo)).toEqual([]);
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`)).toEqual([]);
    }
    expect(await afterPhotos(c1.members.engineer, id)).toEqual([atOpen, inProgress].sort());

    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Clipped and covered" })).toBe("applied");
    for (const outsider of outsiders) expect(await afterPhotos(outsider, id)).toEqual([atOpen, inProgress].sort());
    const frozen = await call<{ frozen: boolean }>(
      k1.members.engineer,
      sql`select frozen_at is not null as frozen from document where work_item_id = ${id}::uuid and field_key = 'after_photos'`,
    );
    expect(frozen).toEqual([{ frozen: true }, { frozen: true }]);
    expect(await afterPhotos(c2.members.engineer, id)).toEqual([]);
  });
});

// RP-981 (INSP-12): an After photo annotated with RP-656's tool. Its copy is a reply Document of the
// same field, C1's until the Resolve as its original is (V19, ADR 0024; scenario RP-981-1).
describe("RP-981: an annotated copy of an After photo goes with its original", () => {
  const startCopy = (as: string, id: string, original: string) =>
    call<{ outcome: string; document_id: string | null }>(
      as,
      sql`select outcome, document_id from app.start_annotated_copy_upload(${id}::uuid, ${original}::uuid, 'after-annotated.jpg', 2048, 'image/jpeg', now())`,
    ).then((rows) => rows[0]!);

  it("C1 annotates it at In Progress; K1 and the Owner read neither until the Resolve shares both, frozen; after a Return only the new photo is annotated", async () => {
    const id = await inProgress("Tray annotated");
    const photo = await addAfterPhoto(c1Pm, id);
    const started = await startCopy(c1.members.engineer, id, photo);
    expect(started.outcome).toBe("started");
    expect(
      await outcome(
        c1.members.engineer,
        sql`select app.confirm_document_upload(${id}::uuid, ${started.document_id}::uuid, 2048, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
      ),
    ).toBe("confirmed");
    const copy = started.document_id!;
    const [row] = (await migrator.query("select reply, field_key, annotated_from_id from document where id = $1", [copy])).rows;
    expect(row).toEqual({ reply: true, field_key: "after_photos", annotated_from_id: photo });
    for (const outsider of [k1.members.engineer, ow.members.representative, c2.members.engineer]) {
      expect(await afterPhotos(outsider, id)).toEqual([]);
      expect(await byId(outsider, copy)).toEqual([]);
      expect((await startCopy(outsider, id, photo)).outcome).toBe("not_found");
    }

    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Bonded" })).toBe("applied");
    for (const reader of [k1.members.engineer, ow.members.representative, c1.members.engineer]) expect(await afterPhotos(reader, id)).toEqual([photo, copy].sort());
    expect(await afterPhotos(c2.members.engineer, id)).toEqual([]);

    expect(await take(k1.members.engineer, id, "return_to_open", { reason: "Label it" })).toBe("applied");
    expect((await startCopy(c1Pm, id, photo)).outcome).toBe("document_frozen");
    const next = await addAfterPhoto(c1Pm, id);
    expect((await startCopy(c1Pm, id, next)).outcome).toBe("started");
  });
});
