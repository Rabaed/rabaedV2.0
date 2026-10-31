// Seam 2 for a reply Screen's own files on the Documental Record (RP-1029; ADR 0023, ADR 0024;
// form-engine.md §6, settled 2026-10-31; visibility.md V19, the Documental Record row, scenario
// RP-1029-1). C1 raises an Inspection on a test Type whose Workflow shows a Screen with a photos
// field and an attachments field at two Transitions: Send to Manager, a move inside K1 (its event
// internal), and Code C, the shared close. K1's Engineer adds a site photo and a test report to the
// first and Sends it to the Manager; the Manager adds a photo and a report of his own to the code's
// Screen and issues Code C.
//
// What the record job reads (app.documental_record_facts, as the worker, with no Member set) holds
// the code's two files, never the Engineer's (app.documents_shared_before_close checks the audience
// of the event that took each reply file, RP-1079). C1 reads the code's files and none of the
// Engineer's; C2, another Contractor of the same Trade not covering the Location, reads none.
// Seam 1: apps/api/test/documental-record-reply-files.test.ts.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db, type RecordFacts } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `WF${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
/** A Screen holding the acting Consultant's own evidence: its photos and its reports. */
const evidenceScreen = (key: string) => ({
  sections: [
    {
      key,
      title: bilingual(`Evidence (${key})`),
      fields: [
        { key: `${key}_photos`, type: "photos", maxFiles: 5, label: bilingual("Site photos") },
        { key: `${key}_reports`, type: "attachments", label: bilingual("Test reports") },
        { key: "remarks", type: "textarea", label: bilingual("Remarks") },
      ],
    },
  ],
});

let migrator: pg.Client;
let app: Db;

const towerOptions = { projectCode: "RRF", tradeCode: "CV", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let id = "";
let facts: RecordFacts;
/** The Engineer's (taken by the internal Send to Manager) and the Manager's (taken by the shared Code C). */
const files = { engineerPhoto: "", engineerReport: "", codePhoto: "", codeReport: "" };

const run = (text: string) => migrator.query(text);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;

const takeWith = (as: string, itemId: string, transition: string, answers: object = {}) =>
  tower.outcome(
    as,
    sql`select app.take_transition(${itemId}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '',
      app.answers_sha256(${itemId}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );

/** `as` adds `fileName` to the reply Screen field `field` of the Inspection: started and confirmed, as the api does once the file is stored. */
async function addReplyFile(as: string, field: string, fileName: string, contentType: string): Promise<string> {
  const [started] = await tower.call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, ${field}, null, ${fileName}, 1024, ${contentType}, now())`,
  );
  expect(started!.outcome, fileName).toBe("started");
  const confirmed = await tower.outcome(
    as,
    sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 1024, ${contentType}, ${randomBytes(32)}::bytea, now()) as outcome`,
  );
  expect(confirmed, fileName).toBe("confirmed");
  return started!.document_id;
}

/** Document `file` as `as` reads it by id: the row, or none. */
const byId = (file: string) => (as: string) =>
  withMember(app, as, (trx) => sql<{ id: string }>`select id from document where id = ${file}::uuid`.execute(trx)).then((r) => r.rows);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });

  const engineerScreen = await addTestScreen(run, `rp1029_engineer_${digits(6)}`, evidenceScreen("engineer"), []);
  const codeScreen = await addTestScreen(run, `rp1029_code_${digits(6)}`, evidenceScreen("code"), []);
  const workflowId = await addTestWorkflow(run, {
    name: bilingual(`RP-1029 record reply files ${digits(6)}`),
    screens: { send_to_manager: engineerScreen, revise_c: codeScreen },
  });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-1029)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [formId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-1029)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { k1 } = tower;

  id = await wirAtConsultant(tower, { type: TYPE, title: "Slab pour, Level 4" });
  files.engineerPhoto = await addReplyFile(k1.members.engineer, "engineer_photos", "engineer-site.jpg", "image/jpeg");
  files.engineerReport = await addReplyFile(k1.members.engineer, "engineer_reports", "engineer-report.pdf", "application/pdf");
  expect(await takeWith(k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
  files.codePhoto = await addReplyFile(k1.members.manager, "code_photos", "code-site.jpg", "image/jpeg");
  files.codeReport = await addReplyFile(k1.members.manager, "code_reports", "cube-test.pdf", "application/pdf");
  expect(await takeWith(k1.members.manager, id, "revise_c", { remarks: "Raise the cover" })).toBe("applied");

  // The record job's read, as the worker: the app role with no Member set.
  const outbox = await one("select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1", [id]);
  facts = (await sql<{ facts: RecordFacts }>`select app.documental_record_facts(${outbox}::uuid) as facts`.execute(app)).rows[0]!.facts;
  expect(facts).not.toBeNull();
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-1029-1: the record's facts hold the reply files the shared code took, never those an internal event took", () => {
  it("each file was taken by the Transition whose Screen it is in: the Engineer's by an internal event, the code's by a shared one", async () => {
    const { rows } = await migrator.query<{ id: string; audience: string }>(
      "select d.id, e.audience from document d join work_item_event e on e.id = d.reply_event_id where d.work_item_id = $1",
      [id],
    );
    const audience = new Map(rows.map((r) => [r.id, r.audience]));
    expect([files.engineerPhoto, files.engineerReport, files.codePhoto, files.codeReport].map((f) => audience.get(f))).toEqual(["internal", "internal", "shared", "shared"]);
  });

  it("give the code's photo and report, with their fingerprints, and none of the Engineer's", () => {
    expect(facts.documents.map((d) => [d.fileName, d.fieldKey, d.itemKey, d.sha256?.length])).toEqual([
      ["code-site.jpg", "code_photos", null, 64],
      ["cube-test.pdf", "code_reports", null, 64],
    ]);
  });

  it("name, anywhere in the facts, only the code's two files of the four, by storage key", async () => {
    const all = [files.engineerPhoto, files.engineerReport, files.codePhoto, files.codeReport];
    const { rows } = await migrator.query<{ id: string; storage_key: string }>("select id, storage_key from document where id = any($1::uuid[])", [all]);
    const keyOf = new Map(rows.map((r) => [r.id, r.storage_key]));
    const text = JSON.stringify(facts);
    expect(all.filter((file) => text.includes(keyOf.get(file)!))).toEqual([files.codePhoto, files.codeReport]);
  });

  it("app.documents_shared_before_close lists the code's two files only, by id", async () => {
    const { rows } = await migrator.query<{ id: string }>("select id from app.documents_shared_before_close($1) order by created_at, id", [id]);
    expect(rows.map((r) => r.id)).toEqual([files.codePhoto, files.codeReport]);
  });

  it("give each Transition's Screen, so the record knows which field is a photo grid and which is listed; the move inside K1 shares no answers", () => {
    const screenOf = (t: RecordFacts["transitions"][number]) => JSON.stringify(t.actionForm);
    const code = facts.transitions.at(-1)!;
    expect(screenOf(code)).toContain('"code_photos"');
    expect(code.answers).toMatchObject({ remarks: "Raise the cover" });
    const move = facts.transitions.find((t) => screenOf(t).includes('"engineer_photos"'))!;
    expect(move.kind).toBe("send");
    expect(move.answers).toBeNull();
  });
});

describe("RP-1029-1: who reads the reply files", () => {
  const name = (as: string) =>
    as === tower.c1.members.engineer ? "C1 engineer" : as === tower.c2.members.engineer ? "C2 engineer" : as === tower.k1.members.engineer ? "K1 engineer" : as === tower.k1.members.manager ? "K1 manager" : as;

  it("C1 and the Owner read the code's files; C2 reads none", async () => {
    for (const file of [files.codePhoto, files.codeReport]) {
      await expectHiddenFrom({
        read: byId(file),
        target: file,
        seenBy: [tower.c1.members.engineer, tower.ow.members.representative, tower.k1.members.engineer],
        hiddenFrom: tower.c2.members.engineer,
        name,
        label: "the code's reply file",
      });
    }
  });

  it("only K1 reads the Engineer's files: C1, the Owner and C2 read neither", async () => {
    for (const file of [files.engineerPhoto, files.engineerReport]) {
      await expectHiddenFrom({
        read: byId(file),
        target: file,
        seenBy: [tower.k1.members.engineer, tower.k1.members.manager],
        hiddenFrom: [tower.c1.members.engineer, tower.ow.members.representative, tower.c2.members.engineer],
        name,
        label: "the Engineer's reply file",
      });
    }
  });
});
