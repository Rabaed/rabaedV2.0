// Seam 2 for a Recommendation's own reply files under the Owner's review (RP-1079; ADR 0022, ADR 0024;
// visibility.md V5, V19 and the Documental Record row; scenarios RP-1079-1 and RP-1079-2), as the app role.
// K1's PM adds a site photo to the "Recommend C" Screen and Recommends C to the Owner. The Transition takes
// the photo, but its events are internal to K1 and the Owner, so the photo goes no further: C1, the
// Contractor, reads it by no channel (the document rows, by id, their times, the shared Documents, the
// Working Copy), neither during the review, after an Owner Send Back, nor after the Confirm, and the
// Documental Record holds it not.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addOwnerReviewWorkflow, addTestScreen, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who.toLowerCase()}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "CNORF";
const RECOMMENDER = "rp1079_recommender";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
const people = { c1Engineer: "", c1Pm: "", k1Pm: "", owPm: "" };
let projectId = "";
let mechanical = "";
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
  return { id, cr, ap };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

const take = (as: string, id: string, transition: string, answers: Record<string, unknown> = {}) =>
  outcome(
    as,
    sql`select app.take_transition(
      ${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, 'A note', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** `as` adds a site photo to the "Recommend C" Screen of item `id`: started and confirmed, as the api does once the file is stored. */
async function addSitePhoto(as: string, id: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, 'site_photos', null, 'site.jpg', 1024, 'image/jpeg', now())`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await outcome(
      as,
      sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 1024, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
    ),
  ).toBe("confirmed");
  return started!.document_id;
}

/** The site photos `as` reads of item `id`, by every channel a reader has. */
async function photosRead(as: string, id: string, photo: string) {
  return {
    rows: (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${id}::uuid and field_key = 'site_photos'`)).map((r) => r.id),
    byId: (await call<{ id: string }>(as, sql`select id from document where id = ${photo}::uuid`)).map((r) => r.id),
    times: (await call<{ document_id: string }>(as, sql`select document_id from app.document_times(${id}::uuid)`)).map((r) => r.document_id).filter((d) => d === photo),
    shared: (await call<{ id: string }>(as, sql`select d as id from app.work_item_shared_documents(${id}::uuid) d`)).map((r) => r.id).filter((d) => d === photo),
  };
}
const none = { rows: [], byId: [], times: [], shared: [] };

/** Whether the item's Working Copy (one content for every viewer) lists the photo. */
const inWorkingCopy = async (id: string, photo: string) => {
  const { rows } = await migrator.query<{ key: string }>("select storage_key as key from document where id = $1", [photo]);
  const content = (await migrator.query<{ c: unknown }>("select app.working_copy_content($1) as c", [id])).rows[0]!.c;
  return JSON.stringify(content).includes(rows[0]!.key);
};
const inRecord = async (id: string, photo: string) =>
  (await migrator.query<{ id: string }>("select id from app.documents_shared_before_close($1)", [id])).rows.some((r) => r.id === photo);

/** A Submitted item, picked up by the Consultant PM. */
async function atConsultant(title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    people.c1Engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${mechanical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(people.c1Engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(people.c1Pm, id)).toBe("picked_up");
  expect(await take(people.c1Pm, id, "submit")).toBe("applied");
  expect(await pickUp(people.k1Pm, id)).toBe("picked_up");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  // "Recommend C" shows a Screen with a reply photos field: the Consultant's own site photos.
  const screen = await addTestScreen(
    run,
    `recommend_c_photos_${randomUUID().slice(0, 8)}`,
    {
      sections: [
        {
          key: "recommendation",
          title: { en: "Recommendation", ar: "التوصية" },
          fields: [{ key: "site_photos", type: "photos", maxFiles: 5, label: { en: "Site photos", ar: "صور الموقع" } }],
        },
      ],
    },
    [],
  );
  const workflowId = await addOwnerReviewWorkflow(run, { screens: { recommend_c: screen } });
  const form = await one(`insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Owner review files", "ar": "ملفات مراجعة المالك"}') returning id`, []);
  await migrator.query(
    "insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)",
    [
      form,
      JSON.stringify({
        sections: [{ key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] }],
      }),
    ],
  );
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, '{"en": "Owner review files", "ar": "ملفات مراجعة المالك"}', $2, 'review_code', $3)`,
    [TYPE, workflowId, form],
  );
  // A Consultant Position that may also attach files in Submittals: no Rabaed Default one does.
  await migrator.query(
    `with p as (
       insert into position (owner_kind, base_role, key, name, sort)
       values ('rabaed', 'consultant', $1, '{"en": "Recommending manager", "ar": "مدير التوصية"}', 99)
       on conflict (base_role, key) do update set sort = excluded.sort
       returning id
     )
     insert into position_permission (position_id, module_key, permission)
     select p.id, 'submittals', x from p, unnest(array['view', 'review', 'approve', 'attach']) x
     on conflict do nothing`,
    [RECOMMENDER],
  );
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const [c1, k1, ow] = [await company(engineer, "C1"), await company(engineer, "K1"), await company(engineer, "OW")];

  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TRF', 'contractor')`);
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  mechanical = await value("trade", "ME");
  buildingA = await value("location", "BA");
  for (const p of [participant.c1, participant.k1, participant.ow]) {
    for (const kind of ["location", "trade"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const staff: [Company, string, keyof typeof people, string[]][] = [
    [c1, participant.c1, "c1Engineer", ["engineer"]],
    [c1, participant.c1, "c1Pm", ["project_manager"]],
    [k1, participant.k1, "k1Pm", [RECOMMENDER]],
    [ow, participant.ow, "owPm", ["project_manager"]],
  ];
  for (const [co, p, who, positions] of staff) {
    people[who] = await member(co.id, who);
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${people[who]}::uuid, now())`);
    for (const kind of ["location", "trade"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${people[who]}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${people[who]}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1079-1: the photos K1's Recommendation takes are read by K1 and the Owner only, during the Owner's review", () => {
  it("C1 reads none by any channel, and the Working Copy lists none; K1 and the Owner read it", async () => {
    const id = await atConsultant("Pump skid");
    const photo = await addSitePhoto(people.k1Pm, id);
    expect(await take(people.k1Pm, id, "recommend_c")).toBe("applied");
    const [taken] = (await migrator.query("select reply_event_id is not null as taken, frozen_at is not null as frozen from document where id = $1", [photo])).rows;
    expect(taken).toEqual({ taken: true, frozen: true });

    for (const c1 of [people.c1Pm, people.c1Engineer]) expect(await photosRead(c1, id, photo)).toEqual(none);
    expect(await inWorkingCopy(id, photo)).toBe(false);
    for (const reader of [people.k1Pm, people.owPm]) {
      expect((await photosRead(reader, id, photo)).rows).toEqual([photo]);
      expect((await photosRead(reader, id, photo)).byId).toEqual([photo]);
    }
    // The Owner holding it reads it too.
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect((await photosRead(people.owPm, id, photo)).byId).toEqual([photo]);
    expect(await photosRead(people.c1Pm, id, photo)).toEqual(none);
  });
});

describe("scenario RP-1079-2: neither an Owner Send Back nor the Confirm shares them, and the record holds none", () => {
  it("C1 reads none after the Send Back, the second Recommendation or the Confirm; documents_shared_before_close lists none", async () => {
    const id = await atConsultant("Chiller");
    const photo = await addSitePhoto(people.k1Pm, id);
    expect(await take(people.k1Pm, id, "recommend_c")).toBe("applied");
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await take(people.owPm, id, "owner_send_back")).toBe("applied");
    expect(await photosRead(people.c1Pm, id, photo)).toEqual(none);
    expect(await inWorkingCopy(id, photo)).toBe(false);
    // K1 holds it again and reads its photo.
    expect((await photosRead(people.k1Pm, id, photo)).byId).toEqual([photo]);

    const second = await addSitePhoto(people.k1Pm, id);
    expect(await take(people.k1Pm, id, "recommend_c")).toBe("applied");
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await take(people.owPm, id, "confirm_c")).toBe("applied");
    expect((await call<{ outcome: string }>(people.c1Pm, sql`select outcome from work_item where id = ${id}::uuid`))[0]!.outcome).toBe("C");

    for (const p of [photo, second]) {
      for (const c1 of [people.c1Pm, people.c1Engineer]) expect(await photosRead(c1, id, p)).toEqual(none);
      expect(await inRecord(id, p)).toBe(false);
      expect(await inWorkingCopy(id, p)).toBe(false);
      for (const reader of [people.k1Pm, people.owPm]) expect((await photosRead(reader, id, p)).byId).toEqual([p]);
    }
  });
});
