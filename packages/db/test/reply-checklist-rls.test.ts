// Seam 2 for a checklist in a reply Screen (RP-86, INSP-4; ADR 0024 amended 2026-10-19, ADR 0025;
// visibility.md V19 and scenario RP-86-1), as the app role. C1 raises an Inspection on a test Type
// whose Form is the WIR Form document (it picks a Checklist Template, copied onto the item) and
// whose Workflow's codes show a Screen holding the copied checklist. K1's Engineer answers it and
// photographs a failed item at the Consultant review Step, then Sends it to the Manager.
//
// RP-86-1: until the code, only K1 reads the answers and photos: neither C1 nor an Owner with
// oversight reads them, by list or by id, and none of them writes them. The code freezes and shares
// them: C1 and the Owner read them in its event, and the photo by id. C2, another Contractor not
// covering the Location, never reads them. Leaving K1 any other way (a Send Back, a cancel)
// discards them.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = `WC${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const FIELD = "inspection_checklist";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const label = (en: string) => ({ en, ar: en });
const items = [
  { key: "formwork", text: label("Formwork tight"), answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative", on_negative: "create_snag" },
  { key: "cover", text: label("Rebar cover"), answers: "pass_fail_na", comment: "optional", photo: "optional", on_negative: "none" },
];
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

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the Inspection.
let k1: Company; // Consultant: inspects; its `member` is the Engineer.
let ow: Company; // Owner: oversight of everything (V2).
let c2: Company; // Another Contractor of the same Trade, covering Building B only (V3).
let c1Pm = "";
let k1Manager = "";
let participant: Record<"c1" | "k1" | "ow" | "c2", string>;
let projectId = "";
let civil = "";
let buildingA = "";
let templateVersion = "";

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

const run = (text: string) => migrator.query(text);
const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
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
async function atConsultantReview(title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ checklist_template: templateVersion })}::jsonb,
      ${civil}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await outcome(c1.member, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  return id;
}

/** At Consultant approval: K1's Engineer answered and photographed the checklist, and Sent it to the Manager, who picked it up. */
async function atManager(title: string): Promise<{ id: string; photo: string }> {
  const id = await atConsultantReview(title);
  expect(await save(k1.member, id)).toBe("saved");
  const photo = await addPhoto(k1.member, id);
  expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1Manager, id)).toBe("picked_up");
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

  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RCK', 'contractor')`,
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
  civil = await value("trade", "CV");
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
    [k1, participant.k1, k1Manager, ["manager"]],
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

  const [template] = await call<{ outcome: string; template_id: string }>(
    c1.ap,
    sql`select outcome, template_id from app.create_checklist_template(${projectId}::uuid, ${JSON.stringify(label("Concrete pour"))}::jsonb, ${civil}::uuid, ${JSON.stringify(items)}::jsonb, now())`,
  );
  expect(template!.outcome).toBe("created");
  templateVersion = await one("select id from checklist_template_version where checklist_template_id = $1 and version_no = 1", [template!.template_id]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-86-1: the Consultant Engineer's checklist stays with K1 until the code (V19)", () => {
  it("before the code, C1 and the Owner read none of the answers or photos, by list or by id; both K1 Members do", async () => {
    const { id, photo } = await atManager("Slab pour, Level 2");

    for (const reader of [k1.member, k1Manager]) {
      expect(await answersAs(reader, id), reader).toEqual([{ field_key: FIELD, answers: ANSWERS }]);
      expect(await photosAs(reader, id), reader).toEqual([photo]);
      expect(await byId(reader, photo), reader).toEqual([photo]);
    }
    for (const outsider of [c1.member, c1Pm, ow.member]) {
      // Each sees the Inspection itself (raised, oversight), never the checklist in progress.
      expect((await call<{ id: string }>(outsider, sql`select id from work_item where id = ${id}::uuid`)).length, outsider).toBe(1);
      expect(await answersAs(outsider, id), outsider).toEqual([]);
      expect(await photosAs(outsider, id), outsider).toEqual([]);
      expect(await byId(outsider, photo), outsider).toEqual([]);
      expect(await codeAnswersAs(outsider, id), outsider).toEqual([]);
      expect(await call(outsider, sql<{ document_id: string }>`select * from app.work_item_shared_documents(${id}::uuid)`), outsider).toEqual([]);
    }
  });

  it("only the Engineer's Step writes them: not the Manager reading them at the code, and nobody outside K1", async () => {
    const { id } = await atManager("Slab pour, Level 3");
    expect(await save(k1Manager, id, { cover: { answer: "fail" } })).toBe("field_not_found");
    expect((await startPhoto(k1Manager, id, "cover")).outcome).toBe("field_not_found");
    for (const outsider of [c1.member, c1Pm, ow.member]) {
      expect(await save(outsider, id), outsider).toBe("not_editable");
      expect((await startPhoto(outsider, id, "cover")).outcome, outsider).toBe("not_editable");
    }
    expect(await save(c2.member, id)).toBe("not_found");
    expect((await startPhoto(c2.member, id, "cover")).outcome).toBe("not_found");
    expect(await answersAs(k1.member, id)).toEqual([{ field_key: FIELD, answers: ANSWERS }]);

    // Returned to the Engineer, it keeps them, and the Engineer changes one.
    expect(await take(k1Manager, id, "return_to_engineer")).toBe("applied");
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await answersAs(k1.member, id)).toEqual([{ field_key: FIELD, answers: ANSWERS }]);
    const changed = { ...ANSWERS, cover: { answer: "na" } };
    expect(await save(k1.member, id, changed)).toBe("saved");
    expect(await answersAs(k1Manager, id)).toEqual([{ field_key: FIELD, answers: changed }]);
  });

  it("an item that is no check item, or one taking no photos, is refused a photo", async () => {
    const id = await atConsultantReview("Slab pour, Level 4");
    expect((await startPhoto(k1.member, id, "made_up")).outcome).toBe("field_not_found");
    expect((await startPhoto(k1.member, id, "formwork")).outcome).toBe("started");
  });

  it("the code freezes and shares them: C1 and the Owner read them in its event, and the photo by id; C2 never", async () => {
    const { id, photo } = await atManager("Slab pour, Level 5");
    expect(await answersAs(c2.member, id)).toEqual([]);
    expect(await take(k1Manager, id, "revise_c", { remarks: "Formwork to be sealed" })).toBe("applied");

    for (const reader of [c1.member, c1Pm, ow.member, k1.member, k1Manager]) {
      expect(await codeAnswersAs(reader, id), reader).toEqual([ANSWERS]);
      expect(await photosAs(reader, id), reader).toEqual([photo]);
      expect(await byId(reader, photo), reader).toEqual([photo]);
      // Taken: none waits any more.
      expect(await answersAs(reader, id), reader).toEqual([]);
    }
    const [frozen] = await call<{ frozen: boolean; taken: boolean }>(
      c1.member,
      sql`select frozen_at is not null as frozen, reply_event_id is not null as taken from document where id = ${photo}::uuid`,
    );
    expect(frozen).toEqual({ frozen: true, taken: true });
    expect(await codeAnswersAs(c2.member, id)).toEqual([]);
    expect(await photosAs(c2.member, id)).toEqual([]);
    expect(await byId(c2.member, photo)).toEqual([]);
  });
});

// A cancel is refused once an item is Submitted (app.cancel_allowed), so it never meets a checklist
// filled after the Submit; closing discards one all the same (work_item_discards_reply_files).
describe("leaving K1 any other way discards them", () => {
  it("a Send Back: the answers and photos are gone, for K1 too, and the item comes back to K1 with an empty checklist", async () => {
    const id = await atConsultantReview("Slab pour, sent back");
    expect(await save(k1.member, id)).toBe("saved");
    const photo = await addPhoto(k1.member, id);
    expect(await take(k1.member, id, "send_back")).toBe("applied");
    for (const reader of [k1.member, c1.member, c1Pm]) {
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
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await answersAs(k1.member, id)).toEqual([]);
    expect(await photosAs(k1.member, id)).toEqual([]);
  });
});
