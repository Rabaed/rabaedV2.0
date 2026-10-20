// Seam 2 for the checklist a Documental Record prints (RP-982, INSP-13; ADR 0023, ADR 0024 amended
// 2026-10-19; visibility.md V19, the Documental Record row, scenario RP-982-1). C1 raises an
// Inspection on a test Type whose Form is the WIR Form document and whose codes show a Screen
// holding the copied checklist (as reply-checklist-rls.test.ts builds it). K1's Engineer answers the
// checklist, photographs it, takes a photo back, and Sends it to the Manager with a Recommended Code
// and an Internal Note; the Manager Returns it, the Engineer changes the answers and adds a photo and
// an annotated copy, and the Manager issues Code C.
//
// What the record job reads (app.documental_record_facts, as the worker, with no Member set) holds
// the checklist exactly as the code took it into its shared event, the copy it answers, and the
// photos the code froze (app.documents_shared_before_close): never the Recommended Code, the
// Internal Note, the answers before the code or the photo taken back. C2, another Contractor of
// the same Trade not covering the Location, gets no record file; C1 does.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db, type RecordFacts } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `WR${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const FIELD = "inspection_checklist";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
/** What the Engineer saved first: changed before the code. */
const FIRST = { formwork: { answer: "fail", comment: "Wedges loose before the pour" }, cover: { answer: "pass" } };
/** What the code took. */
const FINAL = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "fail", snag: false } };
const INTERNAL_NOTE = "Between us: the crew was rushed";
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

const towerOptions = { projectCode: "RRC", tradeCode: "CV", k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;
let tower: Tower;
let id = "";
let facts: RecordFacts;
const photos: Record<"formwork" | "dropped" | "cover" | "annotated", string> = { formwork: "", dropped: "", cover: "", annotated: "" };

const run = (text: string) => migrator.query(text);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;

/** `as` takes `transition` on the Inspection with `answers`, an Internal Note and a Recommended Code. */
const takeWith = (as: string, transition: string, options: { answers?: object; note?: string; recommended?: string } = {}) =>
  tower.outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(options.answers ?? {})}::jsonb, ${options.note ?? ""},
      app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(), null, ${options.recommended ?? null}) as outcome`,
  );
const save = (answers: object) =>
  tower.outcome(tower.k1.members.engineer, sql`select app.save_reply_checklist(${id}::uuid, ${FIELD}, ${JSON.stringify(answers)}::jsonb, now()) as outcome`);

/** K1's Engineer photographs check item `item` as `fileName`: started and confirmed, as the api does once the file is stored. */
async function addPhoto(item: string, fileName: string): Promise<string> {
  const [started] = await tower.call<{ outcome: string; document_id: string }>(
    tower.k1.members.engineer,
    sql`select outcome, document_id from app.start_reply_document_upload(${id}::uuid, ${FIELD}, ${item}, ${fileName}, 1024, 'image/jpeg', now())`,
  );
  expect(started!.outcome).toBe("started");
  const confirmed = await tower.outcome(
    tower.k1.members.engineer,
    sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 1024, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
  );
  expect(confirmed).toBe("confirmed");
  return started!.document_id;
}

/** The record's PDF key `as` gets for the Inspection (app.documental_record_file): none where it doesn't see it. */
const recordFile = (as: string, itemId: string) =>
  withMember(app, as, (trx) => sql<{ storage_key: string }>`select storage_key from app.documental_record_file(${itemId}::uuid)`.execute(trx)).then((r) => r.rows);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });

  const screenVersion = await addTestScreen(run, `rp982_${digits(6)}`, codeScreen, []);
  const workflowId = await addTestWorkflow(run, {
    name: bilingual(`RP-982 record checklist ${digits(6)}`),
    recommendCode: true,
    screens: { approve_a: screenVersion, revise_c: screenVersion },
  });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-982)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [formId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-982)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { k1 } = tower;

  id = await wirAtConsultant(tower, { type: TYPE, title: "Slab pour, Level 2" });
  expect(await save(FIRST)).toBe("saved");
  photos.formwork = await addPhoto("formwork", "formwork.jpg");
  photos.dropped = await addPhoto("cover", "dropped.jpg");
  expect(await tower.outcome(k1.members.engineer, sql`select app.remove_document(${id}::uuid, ${photos.dropped}::uuid, now()) as outcome`)).toBe("removed");
  expect(await takeWith(k1.members.engineer, "send_to_manager", { note: INTERNAL_NOTE, recommended: "A" })).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
  expect(await takeWith(k1.members.manager, "return_to_engineer")).toBe("applied");
  expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
  expect(await save(FINAL)).toBe("saved");
  photos.cover = await addPhoto("cover", "cover.jpg");
  const [copy] = await tower.call<{ outcome: string; document_id: string }>(
    k1.members.engineer,
    sql`select outcome, document_id from app.start_annotated_copy_upload(${id}::uuid, ${photos.formwork}::uuid, 'formwork-annotated.jpg', 2048, 'image/jpeg', now())`,
  );
  expect(copy!.outcome).toBe("started");
  expect(
    await tower.outcome(
      k1.members.engineer,
      sql`select app.confirm_document_upload(${id}::uuid, ${copy!.document_id}::uuid, 2048, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
    ),
  ).toBe("confirmed");
  photos.annotated = copy!.document_id;
  expect(await takeWith(k1.members.engineer, "send_to_manager", { note: INTERNAL_NOTE, recommended: "C" })).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
  expect(await takeWith(k1.members.manager, "revise_c", { answers: { remarks: "Seal the formwork" } })).toBe("applied");

  // The record job's read, as the worker: the app role with no Member set.
  const outbox = await one("select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1", [id]);
  facts = (await sql<{ facts: RecordFacts }>`select app.documental_record_facts(${outbox}::uuid) as facts`.execute(app)).rows[0]!.facts;
  expect(facts).not.toBeNull();
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-982-1: the record's facts hold the checklist as the code shared it, and nothing of the Consultant's own", () => {
  it("give the code's checklist in its shared event, and the copy it answers", () => {
    const code = facts.transitions.at(-1)!;
    expect(code.answers).toMatchObject({ [FIELD]: FINAL });
    expect(facts.checklistCopies).toEqual([
      expect.objectContaining({ fieldKey: "checklist_template", name: expect.objectContaining({ en: expect.any(String) }), items: expect.any(Array) }),
    ]);
    expect(facts.checklistCopies[0]!.versionId).toBe(tower.checklistVersionId);
  });

  it("give the photos the code froze, its annotated copy too, never the one taken back", () => {
    expect(facts.documents.map((d) => [d.fileName, d.fieldKey, d.itemKey])).toEqual([
      ["formwork.jpg", FIELD, "formwork"],
      ["cover.jpg", FIELD, "cover"],
      ["formwork-annotated.jpg", FIELD, "formwork"],
    ]);
  });

  it("never give the Recommended Code, the Internal Note or the answers before the code", () => {
    const text = JSON.stringify(facts);
    for (const hidden of [INTERNAL_NOTE, FIRST.formwork.comment, "dropped.jpg"]) expect(text, hidden).not.toContain(hidden);
    // A Step's outcome mode (`recommend_code`) is the Workflow's, which the record reads to name the issuer; never a Recommended Code.
    expect(JSON.stringify(facts, (key, value: unknown) => (key === "outcomeMode" ? undefined : value))).not.toMatch(/recommend/i);
    // The moves inside K1 share nothing: their events are internal.
    const moves = facts.transitions.filter((t) => t.kind === "send" || t.kind === "return");
    expect(moves.map((t) => t.kind)).toEqual(["send", "send", "return", "send"]);
    for (const move of moves) expect(move.answers, move.label.en).toBeNull();
    expect(facts.transitions.filter((t) => t.answers !== null && FIELD in t.answers)).toHaveLength(1);
  });

  it("give no reply photo a Send Back discarded, nor one no Transition took", async () => {
    const { rows } = await migrator.query<{ file_name: string }>("select file_name from app.documents_shared_before_close($1) order by created_at, id", [id]);
    expect(rows.map((r) => r.file_name)).toEqual(["formwork.jpg", "cover.jpg", "formwork-annotated.jpg"]);
  });
});

describe("RP-982-1: C2 gets no record of the Inspection; C1 does", () => {
  let c2Item = "";

  /** Gives item `itemId` a record, as the worker saves one (the migrator stands in for it here). */
  async function recordFor(itemId: string, code: string) {
    const key = `projects/${tower.projectId}/work-items/${itemId}/documental-record/record.pdf`;
    const file = async (k: string, mime: string) =>
      (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, randomBytes(32), mime])).rows[0]!.id;
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code)
       values ($1, $2, $3, $4, '4', 'bilingual', 'C', $5, now(), $6, $7)`,
      [tower.projectId, itemId, await file(key, "application/pdf"), await file(key.replace("record.pdf", "record-data.xml"), "application/xml"), randomBytes(32), randomBytes(32), code],
    );
  }

  beforeAll(async () => {
    await recordFor(id, "ABCD-EF98");
    // C2's own item with a record: the positive control beside C2's refusal.
    c2Item = await c2Draft(tower, { type: "WIR", title: "Column pour" });
    await recordFor(c2Item, "ABCD-EF97");
  });

  it("C1 and the Owner get its file; C2 gets none, and gets its own item's", async () => {
    for (const reader of [tower.c1.members.engineer, tower.ow.members.representative]) expect(await recordFile(reader, id), reader).toHaveLength(1);
    expect(await recordFile(tower.c2.members.engineer, id)).toEqual([]);
    expect(await recordFile(tower.c2.members.engineer, c2Item)).toHaveLength(1);
  });
});
