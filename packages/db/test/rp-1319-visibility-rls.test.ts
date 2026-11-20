// Seam 2 for RP-1319 (ADR 0030; visibility.md V1, the Working Copy, Documental Record and Verification
// page rows; docs/visibility/scenarios/RP-1319.md; migration 20280101000000_no_number_file_names_admin_lookup_verification.sql),
// as the app role and Rabaed Admin's role. Before its first Submit an item has no Document Number:
// app.request_working_copy, app.documental_record_file and app.linked_documental_record_file name its
// file by its Type and Subject, to the Members who see it only; app.work_item_step_for_engineer finds it
// by its id on its Project, never a Draft, for rabaed_admin only; app.verify_documental_record_by_code
// finds a Record with no number by its code alone and still counts every attempt. On the test Send
// Back Workflow (addTestWorkflow) with a Cancel from each of the raiser's Steps.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `NN${letters(3)}`;
const sha = (s: string) => createHash("sha256").update(s).digest();

let migrator: pg.Client;
let app: Db;
let adminDb: Db;
let tower: SeamTwoTower;
let c1Engineer = "";
let c1Pm = "";
let k1 = "";
let ow = "";
let c2 = "";

const whoIs = (as: string) => ({ [c1Engineer]: "C1 engineer", [c1Pm]: "C1 PM", [k1]: "K1", [ow]: "OW", [c2]: "C2" })[as] ?? `Member ${as}`;
const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;

afterAll(async () => {
  await app?.destroy();
  await adminDb?.destroy();
  await migrator?.end();
});

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 3 });
  adminDb = createDb(urls.admin, { max: 1 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1319 ${digits(6)}`), withCancel: true });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual(`No number (${TYPE})`))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    "insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id) values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)",
    [TYPE, JSON.stringify(bilingual(`No number (${TYPE})`)), workflowId, formId],
  );
  // C2 sees every Trade and Location: it still reads none of C1's items (V3).
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "NNR", c2OtherLocation: false });
  c1Engineer = tower.c1.members.engineer;
  c1Pm = tower.c1.members.project_manager;
  k1 = tower.k1.members.engineer;
  ow = tower.ow.members.representative;
  c2 = tower.c2.members.engineer;
});

async function draft(title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1Engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "M-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome, title).toBe("created");
  return created!.work_item_id;
}
const step = async (as: string, id: string, transition: string) => expect(await tower.take(as, id, transition), transition).toBe("applied");
async function inReview(title: string) {
  const id = await draft(title);
  await step(c1Engineer, id, "send_for_review");
  return id;
}
async function cancelledInReview(title: string) {
  const id = await inReview(title);
  expect(await tower.pickUp(c1Pm, id)).toBe("picked_up");
  await step(c1Pm, id, "cancel_review");
  return id;
}
const numberOf = async (id: string) => (await migrator.query("select document_number from work_item where id = $1", [id])).rows[0].document_number as string | null;

/** A published Documental Record of item `id` with its printed face, as the record job writes them (the migrator stands in). */
async function publishRecord(id: string, code: string, faceNumber: string | null, subject: string) {
  const key = `projects/${tower.projectId}/work-items/${id}/documental-record/rp1319`;
  const file = (name: string, mime: string) => one("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [`${key}/${name}`, sha(`${id} ${name}`), mime]);
  await migrator.query(
    `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
       pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
     values ($1, $2, $3, $4, '2', 'bilingual', 'cancelled', $5, now(), $6, $7, 'published')`,
    [tower.projectId, id, await file("record.pdf", "application/pdf"), await file("record-data.xml", "application/xml"), sha(`pdf ${id}`), sha(randomUUID()), code],
  );
  await migrator.query(
    `insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers)
     select r.id, 'en', $2, $3, '{"en": "Printed Project"}', '{"code": null, "name": {"en": "Cancelled"}}', '[]'
     from documental_record r where r.work_item_id = $1`,
    [id, faceNumber, subject],
  );
}

describe("RP-1319-1: app.request_working_copy for an item with no number yet", () => {
  const ask = (as: string, id: string) =>
    tower.call<{ outcome: string; file_name: string | null }>(as, sql`select outcome, file_name from app.request_working_copy(${id}::uuid, 'rp-1319')`);

  it("RP-1319-1: C1 gets it named \"<Type> - <Subject> - Working Copy.pdf\"; K1, OW and C2 get not_found", async () => {
    const id = await inReview("Cable trays: Level 2/3");
    expect(await numberOf(id)).toBeNull();
    expect((await ask(c1Engineer, id))[0]!.outcome).toBe("preparing");
    const { rows } = await migrator.query("select outbox_id from working_copy where work_item_id = $1 and made_at is null", [id]);
    // The worker, as the app role with no Member set, saves what it printed.
    for (const { outbox_id } of rows) {
      const saved = await sql<{ saved: boolean }>`select app.save_working_copy(${outbox_id}::uuid, ${`projects/x/${outbox_id}.pdf`}) as saved`.execute(app);
      expect(saved.rows[0]!.saved).toBe(true);
    }
    expect(await ask(c1Pm, id)).toEqual([{ outcome: "ready", file_name: `${TYPE} - Cable trays_ Level 2_3 - Working Copy.pdf` }]);
    const seen = async (as: string) => (await ask(as, id)).filter((r) => r.outcome === "ready").map(() => ({ id }));
    await expectHiddenFrom({ read: seen, target: id, seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1, ow, c2], name: whoIs, label: "the Working Copy" });
    for (const as of [k1, ow, c2]) expect(await ask(as, id), whoIs(as)).toEqual([{ outcome: "not_found", file_name: null }]);
  });
});

describe("RP-1319-2: the Documental Record's file of an item cancelled before its first Submit", () => {
  let cancelled = "";
  let from = "";
  let link = "";
  const own = (as: string, id: string) => withMember(app, as, (trx) => sql<{ file_name: string }>`select file_name from app.documental_record_file(${id}::uuid)`.execute(trx)).then((r) => r.rows);
  const viaLink = (as: string) =>
    withMember(app, as, (trx) => sql<{ file_name: string }>`select file_name from app.linked_documental_record_file(${from}::uuid, ${link}::uuid)`.execute(trx)).then((r) => r.rows);

  beforeAll(async () => {
    cancelled = await cancelledInReview("Fire dampers");
    expect(await numberOf(cancelled)).toBeNull();
    await publishRecord(cancelled, "RP13-19D4", null, "Fire dampers");
    // C1's own item in Internal Review links to it (a free Link, written as the owner, as app.add_work_item_link would).
    from = await inReview("Fire damper actuators");
    link = await one("insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id) values ($1, $2, $3, 'related', $4) returning id", [tower.projectId, from, cancelled, c1Engineer]);
  });

  it("RP-1319-2: C1 reads it as \"<Type> - <Subject>.pdf\", never the bare Type code; K1, OW and C2 read nothing", async () => {
    expect(await own(c1Engineer, cancelled)).toEqual([{ file_name: `${TYPE} - Fire dampers.pdf` }]);
    await expectHiddenFrom({ read: async (as: string) => (await own(as, cancelled)).map(() => ({ id: cancelled })), target: cancelled, seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1, ow, c2], name: whoIs, label: "the Record's file" });
  });

  it("RP-1319-2: through a Link of C1's own, the same name; nobody outside C1 reads the Link's item, so nothing", async () => {
    expect(await viaLink(c1Pm)).toEqual([{ file_name: `${TYPE} - Fire dampers.pdf` }]);
    await expectHiddenFrom({ read: async (as: string) => (await viaLink(as)).map(() => ({ id: cancelled })), target: cancelled, seenBy: c1Pm, hiddenFrom: [k1, ow, c2], name: whoIs, label: "the linked Record's file" });
  });
});

describe("RP-1319-3: app.work_item_step_for_engineer finds an item in Internal Review by its id", () => {
  type Found = { work_item_id: string; document_number: string | null; participant_id: string | null; draft_step: boolean; assignment_status: string | null };
  const lookUp = async (projectId: string, lookup: string) =>
    (await sql<Found>`select work_item_id, document_number, participant_id, draft_step, assignment_status from app.work_item_step_for_engineer(${projectId}::uuid, ${lookup})`.execute(adminDb)).rows;

  it("RP-1319-3: by its id on its Project, with C1's Step and no number; not on another Project, not by its Subject", async () => {
    const id = await inReview("Lighting control panels");
    expect(await lookUp(tower.projectId, id)).toEqual([{ work_item_id: id, document_number: null, participant_id: tower.c1.participantId, draft_step: false, assignment_status: "picked_up" }]);
    expect(await lookUp(tower.projectId, `  ${id.toUpperCase()}  `)).toHaveLength(1);
    expect(await lookUp(randomUUID(), id)).toEqual([]); // not hidden-from: the id on a Project that has no such item
    expect(await lookUp(tower.projectId, "Lighting control panels")).toEqual([]); // not hidden-from: there is no Subject search (owner, 2026-11-17)
    expect(await lookUp(tower.projectId, randomUUID())).toEqual([]); // not hidden-from: a made-up id
  });

  it("RP-1319-3: never a Draft, by its id or otherwise: a Draft is its author's alone (V1)", async () => {
    const id = await draft("Draft lighting");
    expect(await lookUp(tower.projectId, id)).toEqual([]); // not hidden-from: Rabaed Admin's lookup; the test above finds an item that left Draft
  });

  it("RP-1319-3: still finds a numbered item by its Document Number", async () => {
    const id = await inReview("Distribution boards");
    expect(await tower.pickUp(c1Pm, id)).toBe("picked_up");
    await step(c1Pm, id, "submit");
    const number = (await numberOf(id))!;
    expect(await lookUp(tower.projectId, number.toLowerCase())).toEqual([expect.objectContaining({ work_item_id: id, document_number: number })]);
    expect(await lookUp(tower.projectId, id)).toEqual([expect.objectContaining({ work_item_id: id, document_number: number })]);
  });

  it("RP-1319-3: is refused to the app role, as every Member and with no Member set", async () => {
    const id = await inReview("Earthing pits");
    for (const as of [c1Pm, k1, c2]) {
      await expect(tower.call(as, sql`select * from app.work_item_step_for_engineer(${tower.projectId}::uuid, ${id})`), whoIs(as)).rejects.toThrow(/permission denied/);
    }
    await expect(sql`select * from app.work_item_step_for_engineer(${tower.projectId}::uuid, ${id})`.execute(app)).rejects.toThrow(/permission denied/);
  });
});

describe("RP-1319-4: app.verify_documental_record_by_code for a Record that never got a number", () => {
  let number = "";
  const visitor = (n: number) => sha(`visitor ${n} of RP-1319 seam 2`);
  const byCode = (code: string, documentNumber: string, who = visitor(0), limit = 1000) =>
    sql<{ outcome: string; verification: Record<string, unknown> | null }>`
      select outcome, verification from app.verify_documental_record_by_code(${code}, ${documentNumber}, ${who}, now(), ${limit}::integer, interval '15 minutes')
    `
      .execute(app)
      .then((r) => r.rows[0]!);

  beforeAll(async () => {
    await publishRecord(await cancelledInReview("Smoke detectors"), "RP13-19E5", null, "Smoke detectors");
    const numbered = await inReview("Sprinkler heads");
    expect(await tower.pickUp(c1Pm, numbered)).toBe("picked_up");
    await step(c1Pm, numbered, "submit");
    number = (await numberOf(numbered))!;
    await publishRecord(numbered, "RP13-19F6", number, "Sprinkler heads");
  });

  it("RP-1319-4: its code alone finds it, whatever the number field holds, with exactly a numbered Record's fields", async () => {
    for (const typed of ["", "No number yet", "anything"]) {
      const found = await byCode("RP13-19E5", typed);
      expect(found.outcome, typed).toBe("found");
      expect(found.verification).toMatchObject({ documentNumber: null, subject: "Smoke detectors" });
    }
    const unnumbered = (await byCode("RP13-19E5", "")).verification!;
    const withNumber = (await byCode("RP13-19F6", number)).verification!;
    expect(Object.keys(unnumbered).sort()).toEqual(Object.keys(withNumber).sort());
  });

  it("RP-1319-4: a numbered Record still needs its number: the code alone or a wrong number is not_found", async () => {
    for (const typed of ["", "No number yet", "NNR-XXX-99-9999"]) expect(await byCode("RP13-19F6", typed), typed).toEqual({ outcome: "not_found", verification: null });
    expect(await byCode("ZZZZ-ZZZZ", "")).toEqual({ outcome: "not_found", verification: null });
  });

  it("RP-1319-4: every attempt still counts: past the limit, even the right code is refused", async () => {
    const who = visitor(1);
    for (let i = 0; i < 3; i++) expect((await byCode("ZZZZ-ZZZZ", "", who, 3)).outcome).toBe("not_found");
    expect(await byCode("RP13-19E5", "", who, 3)).toEqual({ outcome: "too_many_attempts", verification: null });
    expect((await byCode("RP13-19E5", "", visitor(2), 3)).outcome).toBe("found");
  });
});
