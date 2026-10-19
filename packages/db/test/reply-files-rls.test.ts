// Seam 2 for a reply Screen's files (RP-623, SNAG-4; ADR 0024; visibility.md V19 and scenarios
// RP-623-1 to RP-623-3), as the app role. K1, the Consultant, raises a Snag on C1; C1 adds
// After photos to the Resolve Screen's field while it works the Snag. Until the Resolve takes
// them only C1 reads them: neither K1 nor an Owner with oversight reads them, by list or by
// id, and C2, another Contractor of the same Trade covering another Location, never does.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: works the Snag and adds the After photos.
let k1: Company; // Consultant: raises and verifies it.
let ow: Company; // Owner: oversight of everything (V2).
let c2: Company; // Another Contractor of the same Trade, covering Building B only (V3).
let c1Pm = "";
let participant: Record<"c1" | "k1" | "ow" | "c2", string>;
let projectId = "";
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

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
    k1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(k1.member, id, "raise")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "start_work")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RFT', 'contractor')`,
  );
  projectId = created!.project_id;
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  const buildingB = await value("location", "BB");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      const onlyB = p === participant.c2 && kind === "location";
      expect(
        await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${!onlyB}, ${onlyB ? [buildingB] : []}::uuid[], now()) as outcome`),
      ).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [ow, participant.ow, ow.member, ["representative"]],
    [c2, participant.c2, c2.member, ["engineer"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Snag's After photos stay with C1 until its Resolve (V19)", () => {
  it("RP-623-1: before the Resolve, K1 and the Owner read none of C1's After photos, by list or by id; both C1 Members read them", async () => {
    const id = await inProgress("Cable tray not bonded");
    const photo = await addAfterPhoto(c1.member, id);
    // A move inside C1 keeps them with C1.
    expect(await take(c1Pm, id, "put_on_hold_in_progress")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");

    expect(await afterPhotos(c1Pm, id)).toEqual([photo]);
    expect(await afterPhotos(c1.member, id)).toEqual([photo]);
    for (const outsider of [k1.member, ow.member]) {
      // Both see the Snag itself (raised, oversight), never its in-progress files.
      expect((await call<{ id: string }>(outsider, sql`select id from work_item where id = ${id}::uuid`)).length).toBe(1);
      expect(await afterPhotos(outsider, id)).toEqual([]);
      expect(await byId(outsider, photo)).toEqual([]);
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`)).toEqual([]);
    }
    // Nobody else adds one: K1 doesn't hold it.
    expect(
      (await call<{ outcome: string }>(k1.member, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'k1.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_editable");
  });

  it("RP-623-2: C2, another Contractor of the same Trade, reads them neither before nor after the Resolve", async () => {
    const id = await inProgress("Exposed rebar");
    const photo = await addAfterPhoto(c1Pm, id);
    expect(await afterPhotos(c2.member, id)).toEqual([]);
    expect(await byId(c2.member, photo)).toEqual([]);
    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Covered" })).toBe("applied");
    expect(await afterPhotos(c2.member, id)).toEqual([]);
    expect(await byId(c2.member, photo)).toEqual([]);
    expect(
      (await call<{ outcome: string }>(c2.member, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'c2.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_found");
  });

  it("RP-623-3: the Resolve shares them, frozen: K1 and the Owner read them, and C1 may add no more", async () => {
    const id = await inProgress("Corner to clean");
    const photo = await addAfterPhoto(c1Pm, id);
    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Cleaned" })).toBe("applied");
    for (const reader of [k1.member, ow.member, c1.member]) {
      expect(await afterPhotos(reader, id)).toEqual([photo]);
      expect(await byId(reader, photo)).toEqual([photo]);
    }
    const [row] = await call<{ frozen: boolean; taken: boolean }>(
      k1.member,
      sql`select frozen_at is not null as frozen, reply_event_id is not null as taken from document where id = ${photo}::uuid`,
    );
    expect(row).toEqual({ frozen: true, taken: true });
    expect(
      (await call<{ outcome: string }>(c1Pm, sql`select outcome from app.start_reply_document_upload(${id}::uuid, 'after_photos', null, 'late.jpg', 10, 'image/jpeg', now())`))[0]!
        .outcome,
    ).toBe("not_editable");

    // K1 Returns it to Open: what C1 adds for its next Resolve is C1's alone again.
    expect(await take(k1.member, id, "return_to_open", { reason: "Still dusty" })).toBe("applied");
    const next = await addAfterPhoto(c1Pm, id);
    expect(await afterPhotos(c1.member, id)).toEqual([photo, next].sort());
    for (const outsider of [k1.member, ow.member]) {
      expect(await afterPhotos(outsider, id)).toEqual([photo]);
      expect(await byId(outsider, next)).toEqual([]);
    }
  });
});
