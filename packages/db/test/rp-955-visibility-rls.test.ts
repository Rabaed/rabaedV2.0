// Seam 2 for "a close shares only what was handed over" (RP-955, ADR 0027; visibility.md V19;
// scenarios RP-955-1 and RP-955-2), as the app role. After an item closes, a Document or Link its
// holder added after the item's last arrival stays the holder's: no other Participant reads it from
// the `document` or `work_item_link` table, in app.work_item_links, Linked from, or the shared reads
// (app.work_item_shared_documents, app.work_item_shared_links), and what they read is what the
// Documental Record holds (app.documents_shared_before_close, RP-147). A shared reply file the
// closing Code took is handed over with it (ADR 0024).
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "CSHR";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company;
let k1: Company;
let c2: Company;
let c1Pm = "";
let k1Manager = "";
let projectId = "";
let electrical = "";
let buildingA = "";
let x = "";
let y = "";

const names = new Map<string, string>();
const nameOf = (as: string) => names.get(as) ?? "a Member";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
    creator,
  ]);
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

async function addType() {
  const schema = {
    sections: [
      {
        key: "material",
        title: { en: "Material", ar: "المادة" },
        fields: [
          { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
          { key: "datasheet", type: "attachments", label: { en: "Datasheet", ar: "نشرة البيانات" } },
        ],
      },
      {
        key: "classification",
        title: { en: "Classification", ar: "التصنيف" },
        fields: [
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        ],
      },
    ],
  };
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withCancel: true });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Close shares handed over", "ar": "الإغلاق يشارك ما سُلّم"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Close shares handed over", "ar": "الإغلاق يشارك ما سُلّم"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

async function draft(model: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

async function submit(id: string) {
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
}

/** A confirmed Document of item `id`, uploaded by the C1 engineer into the `datasheet` field. */
async function document(id: string, fileName: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    c1.member,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, ${fileName}, 10, 'application/pdf', now(), 'datasheet')`,
  );
  expect(started!.outcome).toBe("started");
  const sha = createHash("sha256").update(fileName, "utf8").digest();
  expect(
    await outcome(c1.member, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${sha}, now()) as outcome`),
  ).toBe("confirmed");
  return started!.document_id;
}

async function link(id: string, to: string): Promise<string> {
  const [added] = await call<{ outcome: string; link_id: string }>(c1.member, sql`select outcome, link_id from app.add_work_item_link(${id}::uuid, ${to}::uuid, now())`);
  expect(added!.outcome).toBe("added");
  return added!.link_id;
}

/**
 * An item C1 Submitted with `shared.pdf` and a Link to X, that K1 Sent Back to C1's Draft, where C1
 * added `held.pdf` and a Link to Y: what it added has arrived nowhere yet.
 */
async function heldAfterSendBack(model: string) {
  const id = await draft(model);
  const shared = await document(id, `${model}-shared.pdf`);
  const sharedLink = await link(id, x);
  await submit(id);
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  expect(await take(k1.member, id, "send_back_to_draft")).toBe("applied");
  const held = await document(id, `${model}-held.pdf`);
  const heldLink = await link(id, y);
  return { id, shared, sharedLink, held, heldLink };
}

// The reads, as the app role, each by id.
const documentRows = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from document where work_item_id = ${id}::uuid`);
const documentById = (documentId: string) => (as: string) => call<{ id: string }>(as, sql`select id from document where id = ${documentId}::uuid`);
const linkRows = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item_link where from_id = ${id}::uuid`);
const itemLinks = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from app.work_item_links(${id}::uuid)`);
const linkedFrom = (to: string) => (as: string) => call<{ id: string }>(as, sql`select work_item_id as id from app.work_item_linked_from(${to}::uuid)`);
const sharedDocuments = (id: string) => (as: string) => call<{ id: string }>(as, sql`select d as id from app.work_item_shared_documents(${id}::uuid) d`);
const sharedLinks = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from app.work_item_shared_links(${id}::uuid)`);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

/** The Documents the item's Documental Record holds, as the record job (the owner) reads them. */
const recordDocuments = async (id: string): Promise<string[]> =>
  (await migrator.query("select id from app.documents_shared_before_close($1)", [id])).rows.map((r) => r.id as string).sort();

/** Rabaed's cancel (workflow-engine.md §9, RP-952; its command isn't built yet): as every close writes it, the open Steps done at the close. */
async function rabaedCancel(id: string, { stepsDone }: { stepsDone: boolean }) {
  await migrator.query("begin");
  if (stepsDone)
    await migrator.query("update step_assignment set status = 'done', done_at = now(), updated_at = now() where work_item_id = $1 and status in ('pooled', 'picked_up', 'vacant')", [id]);
  await migrator.query("update work_item set outcome = 'cancelled', closed_at = now(), updated_at = now() where id = $1", [id]);
  await migrator.query("commit");
}

/** Once closed, `held` and its Link are C1's; what was handed over is everyone's, and the Record's. */
async function expectHandedOverOnly(item: Awaited<ReturnType<typeof heldAfterSendBack>>, label: string) {
  const c1s = [c1.member, c1Pm];
  const k1s = [k1.member, k1Manager];
  await expectHiddenFrom({ read: documentRows(item.id), target: item.held, seenBy: c1s, hiddenFrom: k1s, name: nameOf, label: `${label}, document` });
  await expectHiddenFrom({ read: documentById(item.held), target: item.held, seenBy: c1s, hiddenFrom: k1s, name: nameOf, label: `${label}, document by id` });
  await expectHiddenFrom({ read: linkRows(item.id), target: item.heldLink, seenBy: c1s, hiddenFrom: k1s, name: nameOf, label: `${label}, work_item_link` });
  await expectHiddenFrom({ read: itemLinks(item.id), target: item.heldLink, seenBy: c1s, hiddenFrom: k1s, name: nameOf, label: `${label}, app.work_item_links` });
  await expectHiddenFrom({ read: linkedFrom(y), target: item.id, seenBy: c1s, hiddenFrom: k1s, name: nameOf, label: `${label}, Linked from Y` });
  // What was handed over is still everyone's: by the tables, Linked from X, and the shared reads (the holder's too).
  for (const as of [...c1s, ...k1s]) {
    expect(ids(await documentRows(item.id)(as)), `${label}: ${nameOf(as)} reads shared.pdf`).toContain(item.shared);
    expect(ids(await linkRows(item.id)(as)), `${label}: ${nameOf(as)} reads the Link to X`).toContain(item.sharedLink);
    expect(ids(await linkedFrom(x)(as)), `${label}: ${nameOf(as)} reads it in X's Linked from`).toContain(item.id);
    expect(ids(await sharedDocuments(item.id)(as)), `${label}: ${nameOf(as)}'s shared Documents`).toEqual([item.shared]);
    expect(ids(await sharedLinks(item.id)(as)), `${label}: ${nameOf(as)}'s shared Links`).toEqual([item.sharedLink]);
  }
  // The live item and the sealed Record agree.
  expect(ids(await documentRows(item.id)(k1.member)), `${label}: K1's Documents are the Record's`).toEqual(await recordDocuments(item.id));
  // C2, another Contractor, never sees the item.
  await expectHiddenFrom({ read: (as) => call<{ id: string }>(as, sql`select id from work_item where id = ${item.id}::uuid`), target: item.id, seenBy: [c1.member, k1.member], hiddenFrom: c2.member, name: nameOf, label: `${label}, the item` });
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");
  for (const [as, name] of [
    [c1.member, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.member, "the K1 engineer"],
    [k1Manager, "the K1 manager"],
    [c2.member, "the C2 engineer"],
  ] as const)
    names.set(as, name);
  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'CSH', 'contractor')`);
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
  };
  const value = async (kind: string, valueCode: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, ${JSON.stringify({ en: valueCode, ar: valueCode })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
    [c2, participant.c2, c2.member, ["engineer"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
  x = await draft("CSHR-X");
  await submit(x);
  y = await draft("CSHR-Y");
  await submit(y);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-955-1: Rabaed cancels an item Sent Back to C1, because a Company left the Project", () => {
  it("a Member's Cancel isn't offered once the item was Submitted (RP-433): Rabaed's cancel is the close that finds the holder's additions", async () => {
    const item = await heldAfterSendBack("CSHR-0");
    expect(await pickUp(c1.member, item.id)).toBe("picked_up");
    expect(await take(c1.member, item.id, "cancel")).toBe("transition_not_available");
  });

  it("with its open Steps done at the close: what C1 added after the Send Back stays C1's", async () => {
    const item = await heldAfterSendBack("CSHR-1");
    await rabaedCancel(item.id, { stepsDone: true });
    await expectHandedOverOnly(item, "RP-955-1");
  });

  it("a Link Rabaed adds after the close is everyone's who sees the item; C1's own, added before the close, stays C1's", async () => {
    const item = await heldAfterSendBack("CSHR-1R");
    await rabaedCancel(item.id, { stepsDone: true });
    // The one row Rabaed adds to a closed item: a Revision's chain Link from the item it revises, at the
    // Revision's first Submit (RP-316, app.take_transition), stamped with the close's own arrival by the
    // insert trigger. Written here as that Submit writes it, to a Submitted item standing for the Revision;
    // the real Revision path is revisions.test.ts and revision-rls.test.ts (scenario 62).
    const later = await draft("CSHR-1R later");
    await submit(later);
    const chain = await one(
      `insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
       values ($1, $2, $3, 'related', $4, now()) returning id`,
      [projectId, item.id, later, c1.member],
    );
    const seenBy = [c1.member, c1Pm, k1.member, k1Manager];
    for (const read of [linkRows(item.id), itemLinks(item.id)])
      for (const as of seenBy) expect(ids(await read(as)), `${nameOf(as)} reads the Link added after the close`).toContain(chain);
    for (const as of [c1.member, k1.member]) expect(ids(await sharedLinks(item.id)(as)), `${nameOf(as)}'s shared Links`).toEqual([item.sharedLink, chain].sort());
    await expectHiddenFrom({ read: linkedFrom(later), target: item.id, seenBy, hiddenFrom: c2.member, name: nameOf, label: "RP-955-1, Linked from of the later item" });
    await expectHiddenFrom({ read: linkRows(item.id), target: item.heldLink, seenBy: [c1.member, c1Pm], hiddenFrom: [k1.member, k1Manager], name: nameOf, label: "RP-955-1, C1's own Link beside the later one" });
  });

  it("with its Steps left open, as the Record's own test closes it: the same", async () => {
    const item = await heldAfterSendBack("CSHR-1B");
    await rabaedCancel(item.id, { stepsDone: false });
    await expectHandedOverOnly(item, "RP-955-1 (Steps open)");
  });
});

describe("scenario RP-955-2: a reply file the closing Code took is handed over with it", () => {
  it("is read by C1 and K1 from the table and by id, and the Record holds it; C2 reads none", async () => {
    const id = await draft("CSHR-2");
    const shared = await document(id, "CSHR-2-shared.pdf");
    await submit(id);
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1Manager, id)).toBe("picked_up");
    expect(await take(k1Manager, id, "approve_a")).toBe("applied");
    // A file K1's manager put in the Code's reply Screen while holding the item, taken by the Code (ADR 0024):
    // the test Workflow's Code has no Screen, so the row is written as the take writes it.
    const reply = await one(
      `insert into document (id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
         uploaded_by_member_id, uploaded_by_participant_id, confirmed_at, reply, field_key, reply_event_id)
       select d.id, e.project_id, e.work_item_id, 'CSHR-2-code.pdf', 10, 'application/pdf',
         app.document_storage_key(e.project_id, e.work_item_id, d.id),
         e.actor_member_id, e.actor_participant_id, e.created_at, true, 'code_files', e.id
       from work_item_event e, (select gen_random_uuid() as id) d
       where e.work_item_id = $1 and e.type in ('transition', 'issue_code') and e.audience = 'shared'
       order by e.created_at desc, e.seq desc limit 1
       returning id`,
      [id],
    );
    // Added during the arrival the close follows (the insert stamps the current one), and frozen by the Code.
    await migrator.query("update document d set arrival = w.arrivals - 1, frozen_at = d.confirmed_at from work_item w where w.id = d.work_item_id and d.id = $1", [reply]);

    const everyone = [c1.member, c1Pm, k1.member, k1Manager];
    await expectHiddenFrom({ read: documentRows(id), target: reply, seenBy: everyone, hiddenFrom: c2.member, name: nameOf, label: "RP-955-2, document" });
    await expectHiddenFrom({ read: documentById(reply), target: reply, seenBy: everyone, hiddenFrom: c2.member, name: nameOf, label: "RP-955-2, document by id" });
    for (const as of [c1.member, k1.member]) expect(ids(await sharedDocuments(id)(as)), `${nameOf(as)}'s shared Documents`).toEqual([shared, reply].sort());
    expect(ids(await documentRows(id)(c1.member)), "C1's Documents are the Record's").toEqual(await recordDocuments(id));
    expect(await recordDocuments(id)).toEqual([shared, reply].sort());
  });
});
