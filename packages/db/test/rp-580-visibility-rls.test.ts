// Seam 2 for scenario RP-580-1 (ADR 0021, ADR 0014; workflow-engine.md §1; visibility.md V19), as the app
// role. K1 Sends a Submitted item Back to C1's Draft Step, which says "After a Send Back: Comment only":
// C1's engineer, holding it, changes nothing of the Form (an answer, a checklist item, Trade, Location,
// Scopes, a Document, a Link), each refused `not_editable` (a frozen Document's removal `document_frozen`),
// and Submits it again with an Internal Note; K1 then reads exactly what it read at the Send Back. Only C1's
// Members learn that the item was sent back for comment. Another item, Sent Back to Contractor review, is
// Returned to the Draft by the PM and is still read-only there. The positive control: the same changes on
// the same Workflow at "Edit the Form" are saved. Seam 1: apps/api/test/after-send-back.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, sha256Bytea, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const COMMENT = `RC${letters(3)}`;
const EDIT = `RE${letters(3)}`;
const towerOptions = { projectCode: "RSB", k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;

const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
        {
          key: "pour_check",
          type: "checklist",
          label: bilingual("Pour check"),
          items: [{ key: "formwork", text: bilingual("Formwork"), answers: "pass_fail_na", comment: "optional", photo: "optional" }],
        },
      ],
    },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let migrator: pg.Client;
let app: Db;
let tower: Tower;
let call: Tower["call"];
let outcome: Tower["outcome"];
let pickUp: Tower["pickUp"];
let engineer = ""; // C1's engineer: raises the items.
let pm = ""; // C1's PM: Contractor review, Submits.
let k1Engineer = ""; // Holds Consultant review, and Sends Back.
let k1Manager = ""; // Another K1 Member who sees the item, holding nothing.
let owner = ""; // The Owner's representative, with oversight.
let mechanical = "";
let lighting = "";
let power = "";

/** A Type `code` on the test Workflow, its raiser's Steps a Send Back leads to set to `setting`. */
async function addType(code: string, setting: "comment" | "edit_form") {
  const workflowId = await addTestWorkflow((text) => migrator.query(text), {
    name: bilingual(`RP-580 ${setting} ${digits(6)}`),
    afterSendBack: { draft: setting, internal_review: setting },
  });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "After a Send Back", "ar": "بعد الإرجاع"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${code}', '{"en": "After a Send Back", "ar": "بعد الإرجاع"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const answers = (model: string, formwork = "pass") => ({ model, pour_check: { formwork: { answer: formwork } } });
/** `as` takes `transition` on item `id` with an Internal Note `note`; returns the outcome. */
const take = (as: string, id: string, transition: string, note = "") =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, ${note}, app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const save = (id: string, data: object, trade: string, location: string, scopes: string[]) =>
  outcome(
    engineer,
    sql`select app.save_work_item_answers(${id}::uuid, ${JSON.stringify(data)}::jsonb, ${trade}::uuid, ${location}::uuid, ${scopes}::uuid[], now()) as outcome`,
  );
const startUpload = (id: string, fileName: string) =>
  call<{ outcome: string; document_id: string | null }>(
    engineer,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, ${fileName}, 10, 'application/pdf', now(), 'datasheet')`,
  ).then((rows) => rows[0]!);
const addLink = (id: string, to: string) =>
  call<{ outcome: string; link_id: string | null }>(engineer, sql`select outcome, link_id from app.add_work_item_link(${id}::uuid, ${to}::uuid, now())`).then(
    (rows) => rows[0]!,
  );

async function raise(type: string, model: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${type}, ${model}, app.latest_form_version(${type}), ${JSON.stringify(answers(model))}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  expect(await save(created!.work_item_id, answers(model), tower.tradeId, tower.buildingA, [lighting])).toBe("saved");
  return created!.work_item_id;
}

async function submit(id: string) {
  expect(await take(engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, id, "submit")).toBe("applied");
}

/** An item of `type` with a Datasheet and a Link, Submitted, then Sent Back by K1's engineer with `transition`. */
async function sentBack(type: string, model: string, transition: "send_back" | "send_back_to_draft") {
  // A Draft is never linked: the other item is Submitted first.
  const other = await raise(type, `${model}-other`);
  await submit(other);
  const id = await raise(type, model);
  const started = await startUpload(id, `${model}.pdf`);
  expect(started.outcome).toBe("started");
  const datasheet = started.document_id!;
  expect(
    await outcome(
      engineer,
      sql`select app.confirm_document_upload(${id}::uuid, ${datasheet}::uuid, 10, 'application/pdf', ${sha256Bytea(model)}, now()) as outcome`,
    ),
  ).toBe("confirmed");
  expect((await addLink(id, other)).outcome).toBe("added");
  await submit(id);
  expect(await pickUp(k1Engineer, id)).toBe("picked_up");
  expect(await take(k1Engineer, id, transition, "K1's own note")).toBe("applied");
  return { id, other, datasheet };
}

/** What `as` reads of item `id`: its answers, Scopes, Documents and Links. */
const reads = async (as: string, id: string) => ({
  answers: (await call<{ a: unknown }>(as, sql`select app.work_item_answers(${id}::uuid) as a`))[0]!.a,
  scopes: (await call<{ s: string }>(as, sql`select scope_id as s from work_item_scope_seen where work_item_id = ${id} order by scope_id`)).map((r) => r.s),
  documents: (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${id} order by id`)).map((r) => r.id),
  links: (await call<{ id: string }>(as, sql`select id from app.work_item_links(${id}::uuid) order by id`)).map((r) => r.id),
});
/** Item `id` as a row by id when `as` is told it was sent back for comment; none otherwise. */
const toldSentBack = (id: string) => async (as: string) =>
  (await call<{ told: boolean }>(as, sql`select app.sent_back_for_comment(${id}::uuid) as told`))[0]!.told ? [{ id }] : [];
/** The event of item `id` holding Internal Note `note`, by id, read as the migrator. */
const noteEvent = async (id: string, note: string) =>
  (await migrator.query("select id from work_item_event where work_item_id = $1 and payload ->> 'internal_note' = $2", [id, note])).rows[0].id as string;
const eventById = (event: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item_event where id = ${event}::uuid`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType(COMMENT, "comment");
  await addType(EDIT, "edit_form");
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  ({ call, outcome, pickUp } = tower);
  engineer = tower.c1.members.engineer;
  pm = tower.c1.members.project_manager;
  k1Engineer = tower.k1.members.engineer;
  k1Manager = tower.k1.members.manager;
  owner = tower.ow.members.representative;
  mechanical = (
    await call<{ value_id: string }>(
      tower.c1.ap,
      sql`select value_id from app.add_dimension_value(${tower.projectId}::uuid, 'trade', null, 'ME', ${JSON.stringify(bilingual("Mechanical"))}::jsonb)`,
    )
  )[0]!.value_id;
  const scope = async (name: string) =>
    (
      await call<{ scope_id: string }>(
        tower.c1.ap,
        sql`select scope_id from app.add_scope(${tower.projectId}::uuid, ${tower.tradeId}::uuid, null, ${JSON.stringify(bilingual(name))}::jsonb)`,
      )
    )[0]!.scope_id;
  lighting = await scope("Lighting");
  power = await scope("Power");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-580-1: an item Sent Back to a \"Comment only\" Draft Step", () => {
  let id = "";
  let other = "";
  let datasheet = "";
  let k1Before: Awaited<ReturnType<typeof reads>>;

  beforeAll(async () => {
    ({ id, other, datasheet } = await sentBack(COMMENT, "CMT-1", "send_back_to_draft"));
    k1Before = await reads(k1Manager, id);
  });

  it("is held by the engineer again, who may not save; only C1's Members are told it was sent back for comment", async () => {
    expect(await call(engineer, sql<{ can: boolean }>`select app.can_save_answers(${id}::uuid) as can`)).toEqual([{ can: false }]);
    await expectHiddenFrom({ read: toldSentBack(id), target: id, seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, owner], label: "sent back for comment" });
    // K1 and the Owner still see the item itself (V19), so the false above is the note's, not the item's.
    for (const viewer of [k1Engineer, k1Manager, owner]) expect(await call(viewer, sql<{ id: string }>`select id from work_item where id = ${id}`)).toEqual([{ id }]);
  });

  it("refuses the engineer saving an answer, a checklist item, Trade, Location and Scopes, not_editable", async () => {
    const { tradeId, buildingA, buildingB } = tower;
    expect(await save(id, answers("CMT-1a"), tradeId, buildingA, [lighting])).toBe("not_editable");
    expect(await save(id, answers("CMT-1", "fail"), tradeId, buildingA, [lighting])).toBe("not_editable");
    expect(await save(id, answers("CMT-1"), mechanical, buildingA, [])).toBe("not_editable");
    expect(await save(id, answers("CMT-1"), tradeId, buildingB, [lighting])).toBe("not_editable");
    expect(await save(id, answers("CMT-1"), tradeId, buildingA, [power])).toBe("not_editable");
    expect((await reads(engineer, id)).answers).toMatchObject(answers("CMT-1"));
    expect((await reads(engineer, id)).scopes).toEqual([lighting]);
  });

  it("refuses adding a Document or a Link, not_editable, and removing its frozen Document, document_frozen", async () => {
    expect(await startUpload(id, "CMT-1-new.pdf")).toEqual({ outcome: "not_editable", document_id: null });
    expect(await outcome(engineer, sql`select app.remove_document(${id}::uuid, ${datasheet}::uuid, now()) as outcome`)).toBe("document_frozen");
    expect(await addLink(id, other)).toEqual({ outcome: "not_editable", link_id: null });
    const mine = await reads(engineer, id);
    expect(mine.documents).toEqual([datasheet]);
    expect(mine.links).toEqual(k1Before.links);
  });

  it("lets the engineer reply with an Internal Note and Submit it again; K1 reads exactly what it read at the Send Back, never C1's notes", async () => {
    expect(await take(engineer, id, "send_for_review", "Replied: the datasheet is the current one")).toBe("applied");
    expect(await pickUp(pm, id)).toBe("picked_up");
    expect(await take(pm, id, "submit", "Submitted again unchanged")).toBe("applied");
    expect(await reads(k1Manager, id)).toEqual(k1Before);
    expect(await reads(k1Engineer, id)).toEqual(k1Before);
    for (const note of ["Replied: the datasheet is the current one", "Submitted again unchanged"]) {
      await expectHiddenFrom({ read: eventById(await noteEvent(id, note)), target: await noteEvent(id, note), seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, owner], label: `C1's note "${note}"` });
    }
    // K1's own note on its Send Back stays K1's.
    const k1Note = await noteEvent(id, "K1's own note");
    await expectHiddenFrom({ read: eventById(k1Note), target: k1Note, seenBy: [k1Engineer, k1Manager], hiddenFrom: [engineer, pm, owner], label: "K1's note" });
    // Back at K1, nobody is told it was sent back for comment any more.
    for (const who of [engineer, pm]) expect(await toldSentBack(id)(who)).toEqual([]); // not hidden-from: Submitted again, so it is sent back for comment to nobody; C1 read it above
  });
});

describe("scenario RP-580-1: \"Comment only\" holds at the Draft after the PM's Return", () => {
  it("Sent Back to Contractor review, Returned by the PM to the Draft, still refuses the engineer's save", async () => {
    const { id } = await sentBack(COMMENT, "CMT-2", "send_back");
    expect(await pickUp(pm, id)).toBe("picked_up");
    await expectHiddenFrom({ read: toldSentBack(id), target: id, seenBy: pm, hiddenFrom: [k1Engineer, k1Manager, owner], label: "sent back for comment, at Contractor review" });
    expect(await take(pm, id, "return")).toBe("applied");
    expect(await call(engineer, sql<{ can: boolean }>`select app.can_save_answers(${id}::uuid) as can`)).toEqual([{ can: false }]);
    expect(await save(id, answers("CMT-2a"), tower.tradeId, tower.buildingA, [lighting])).toBe("not_editable");
    await expectHiddenFrom({ read: toldSentBack(id), target: id, seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, owner], label: "sent back for comment, at the Draft" });
  });
});

// The positive control beside each refusal above: the same engineer, the same changes, on the same
// Workflow at "Edit the Form", are saved, and K1 reads them only once the item is Submitted again.
describe("the positive control: an item Sent Back to an \"Edit the Form\" Draft Step", () => {
  it("lets the engineer change an answer, the checklist, Trade, Scopes, a Document and a Link, which reach K1 only at the Submit", async () => {
    const { id, datasheet } = await sentBack(EDIT, "EDT-1", "send_back_to_draft");
    const other = await raise(EDIT, "EDT-1-second");
    await submit(other);
    const k1Before = await reads(k1Manager, id);
    expect(await call(engineer, sql<{ can: boolean }>`select app.can_save_answers(${id}::uuid) as can`)).toEqual([{ can: true }]);
    expect(await toldSentBack(id)(engineer)).toEqual([]); // not hidden-from: "Edit the Form" is sent back for comment to nobody, its raiser included
    expect(await save(id, answers("EDT-1a", "fail"), mechanical, tower.buildingA, [])).toBe("saved");
    expect(await save(id, answers("EDT-1a", "fail"), tower.tradeId, tower.buildingA, [power])).toBe("saved");
    const added = await startUpload(id, "EDT-1-new.pdf");
    expect(added.outcome).toBe("started");
    expect(
      await outcome(engineer, sql`select app.confirm_document_upload(${id}::uuid, ${added.document_id}::uuid, 10, 'application/pdf', ${sha256Bytea("EDT-1-new")}, now()) as outcome`),
    ).toBe("confirmed");
    const link = await addLink(id, other);
    expect(link.outcome).toBe("added");
    // Its frozen Document stays frozen at "Edit the Form" too.
    expect(await outcome(engineer, sql`select app.remove_document(${id}::uuid, ${datasheet}::uuid, now()) as outcome`)).toBe("document_frozen");
    expect(await reads(k1Manager, id)).toEqual(k1Before);
    const docsOf = (as: string) => call<{ id: string }>(as, sql`select id from document where work_item_id = ${id}`);
    await expectHiddenFrom({ read: docsOf, target: added.document_id!, seenBy: engineer, hiddenFrom: [k1Engineer, k1Manager, owner], label: "the added Document, before the Submit" });
    await submit(id);
    const k1Now = await reads(k1Manager, id);
    expect(k1Now.answers).toMatchObject(answers("EDT-1a", "fail"));
    expect(k1Now.scopes).toEqual([power]);
    expect(k1Now.documents).toContain(added.document_id);
    expect(k1Now.links).toContain(link.link_id);
  });
});
