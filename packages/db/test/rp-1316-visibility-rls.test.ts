// Seam 2 for "a Document Number is given at the first Submit" (RP-1316, ADR 0030; visibility.md V1 and
// scenario 53; scenarios RP-1316-1 and RP-1316-2), as the app role. Send for Review no longer numbers an
// item: its first Submit out of the raiser's Participant does, with its Submission Date, so an item
// cancelled in Internal Review never had a number and leaves no gap that another Company sees. The
// Creation Date (left_draft_at) stays at the first exit from Draft. An item whose Workflow has no Submit
// is numbered when it first leaves Draft; two Submits at once take consecutive numbers (ADR 0008).
// On the test Send Back Workflow (addTestWorkflow) with a Cancel from each of the raiser's Steps.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `NS${letters(3)}`;
/** A Type on the same Workflow without its Submit: leaving Draft is its Submit (ADR 0030). */
const NO_SUBMIT = `NX${letters(3)}`;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<{ k1Manager: true }>;

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;

/** A Type `code` in the Submittals on Workflow `workflowId`, with a one-field Form. */
async function addType(code: string, workflowId: string) {
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual(`Numbering (${code})`))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    "insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id) values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)",
    [code, JSON.stringify(bilingual(`Numbering (${code})`)), workflowId, formId],
  );
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 3 });
  await addType(TYPE, await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1316 ${digits(6)}`), withCancel: true }));
  // The same route with no Submit: Draft ─send_for_review→ Contractor review, then only a Cancel.
  const noSubmit = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1316 no Submit ${digits(6)}`), withCancel: true, publish: false });
  const version = await one("select id from workflow_version where workflow_definition_id = $1", [noSubmit]);
  await migrator.query("delete from workflow_transition where workflow_version_id = $1 and from_step_id in (select id from workflow_step where workflow_version_id = $1 and key not in ('draft', 'internal_review'))", [version]);
  await migrator.query("delete from workflow_transition where workflow_version_id = $1 and kind = 'submit'", [version]);
  await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [version]);
  await addType(NO_SUBMIT, noSubmit);
  // C2 sees every Trade and Location: it still reads none of C1's items (V3).
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "NFS", k1Manager: true, c2OtherLocation: false });
});

/** C1's Engineer raises a Draft of `type` on the Tower's Trade and Building A. */
async function draft(title: string, type = TYPE): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ model: "M-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome, title).toBe("created");
  return created!.work_item_id;
}
const step = async (as: string, id: string, transition: string) => expect(await tower.take(as, id, transition), transition).toBe("applied");
const pick = async (as: string, id: string) => expect(await tower.pickUp(as, id), "pick up").toBe("picked_up");
async function inReview(title: string, type = TYPE) {
  const id = await draft(title, type);
  await step(tower.c1.members.engineer, id, "send_for_review");
  return id;
}
/** C1's PM takes item `id` at Internal Review and Submits it to K1. */
async function submit(id: string) {
  await pick(tower.c1.members.project_manager, id);
  await step(tower.c1.members.project_manager, id, "submit");
}
async function submitted(title: string) {
  const id = await inReview(title);
  await submit(id);
  return id;
}
async function cancelledInReview(title: string) {
  const id = await inReview(title);
  await pick(tower.c1.members.project_manager, id);
  await step(tower.c1.members.project_manager, id, "cancel_review");
  return id;
}

type Stored = { document_number: string | null; numbered_at: Date | null; left_draft_at: Date | null; submitted_at: Date | null };
const stored = async (id: string): Promise<Stored> =>
  (await migrator.query("select document_number, numbered_at, left_draft_at, submitted_at from work_item where id = $1", [id])).rows[0];

/** Project items as `as` reads them on the List (app.work_items_seen), with their Document Numbers. */
const listOf = (as: string) =>
  tower.call<{ id: string; document_number: string | null }>(as, sql`select s.id, s.document_number from app.work_items_seen(${tower.projectId}::uuid, array['submittals'], true) s`);
/** Every Document Number a reader finds anywhere it reads one: the List, and every shared event's payload. */
const numbersOf = async (as: string) => {
  const listed = (await listOf(as)).map((r) => r.document_number).filter((n): n is string => n !== null);
  const events = await tower.call<{ n: string | null }>(
    as,
    sql`select e.payload ->> 'document_number' as n from work_item_event e where e.project_id = ${tower.projectId}::uuid`,
  );
  return [...new Set([...listed, ...events.map((e) => e.n).filter((n): n is string => n !== null)])].sort();
};
const seq = (n: string) => Number(n.slice(-4));

describe("the Document Number comes at the first Submit (ADR 0030)", () => {
  it("Send for Review gives none; the Creation Date is set at the first exit from Draft and read by C1 only", async () => {
    const id = await inReview("Send for Review: no number");
    const row = await stored(id);
    expect(row).toMatchObject({ document_number: null, numbered_at: null, submitted_at: null });
    expect(row.left_draft_at).not.toBeNull();
    const [read] = await tower.call<{ creation_date: Date | null }>(tower.c1.members.engineer, sql`select app.work_item_creation_date(${id}::uuid) as creation_date`);
    expect(read!.creation_date).toEqual(row.left_draft_at);
    // Still C1's own work: it reads it, with no number, and nobody else reads it at all (V1).
    expect((await listOf(tower.c1.members.engineer)).find((r) => r.id === id)).toEqual({ id, document_number: null });
  });

  it("the first Submit gives it, at the moment of its Submission Date, written on the Submit's shared event", async () => {
    const id = await inReview("Submit: numbered");
    const before = await stored(id);
    await submit(id);
    const row = await stored(id);
    expect(row.document_number).toMatch(/^NFS-[A-Z]{5}-\d{2}-\d{4}$/);
    expect(row.numbered_at).toEqual(row.submitted_at);
    expect(row.left_draft_at, "the Creation Date stays at the first exit from Draft").toEqual(before.left_draft_at);
    const { rows } = await migrator.query(
      "select e.audience, e.payload ->> 'document_number' as n from work_item_event e join workflow_transition t on t.id = e.transition_id where e.work_item_id = $1 and t.key in ('send_for_review', 'submit') order by e.seq",
      [id],
    );
    expect(rows).toEqual([{ audience: "internal", n: null }, { audience: "shared", n: row.document_number }]);
  });

  it("an item whose Workflow has no Submit is numbered when it first leaves Draft", async () => {
    const id = await inReview("No Submit: numbered on leaving Draft", NO_SUBMIT);
    const row = await stored(id);
    expect(row.document_number).toMatch(new RegExp(`^NFS-${NO_SUBMIT}-\\d{2}-0001$`));
    expect(row.numbered_at).toEqual(row.left_draft_at);
  });

  it("a Draft cancelled, and an item cancelled in Internal Review, never had a number", async () => {
    const cancelledDraft = await draft("Cancelled as a Draft");
    await step(tower.c1.members.engineer, cancelledDraft, "cancel");
    expect(await stored(cancelledDraft)).toMatchObject({ document_number: null, numbered_at: null, left_draft_at: null });
    const cancelled = await cancelledInReview("Cancelled in Internal Review");
    const row = await stored(cancelled);
    expect(row).toMatchObject({ document_number: null, numbered_at: null });
    expect(row.left_draft_at).not.toBeNull();
  });

  it("an item numbered at Send for Review before RP-1316 keeps its number at its Submit, and no counter moves (AC 5)", async () => {
    const id = await inReview("Numbered before RP-1316");
    // As the engine did before RP-1316, on leaving Draft: the number and numbered_at with the Creation Date.
    await migrator.query("update work_item set document_number = app.issue_document_number(id, left_draft_at), numbered_at = left_draft_at where id = $1", [id]);
    const before = await stored(id);
    const counters = async () => (await migrator.query("select counter_key, last_value from numbering_counter where project_id = $1 order by counter_key", [tower.projectId])).rows;
    const countersBefore = await counters();
    await submit(id);
    const after = await stored(id);
    expect(after).toMatchObject({ document_number: before.document_number, numbered_at: before.numbered_at, left_draft_at: before.left_draft_at });
    expect(after.submitted_at).not.toBeNull();
    expect(await counters()).toEqual(countersBefore);
  });

  it("two items Submitted at the same moment take consecutive numbers (ADR 0008)", async () => {
    const a = await inReview("At once: A");
    const b = await inReview("At once: B");
    await pick(tower.c1.members.project_manager, a);
    await pick(tower.c1.members.project_manager, b);
    const outcomes = await Promise.all([a, b].map((id) => tower.take(tower.c1.members.project_manager, id, "submit")));
    expect(outcomes).toEqual(["applied", "applied"]);
    const numbers = [(await stored(a)).document_number!, (await stored(b)).document_number!].map(seq).sort((x, y) => x - y);
    expect(numbers[1]! - numbers[0]!).toBe(1);
  });
});

describe("visibility.md, Document Numbers (RP-1316)", () => {
  it("RP-1316-1: C1 cancels one item in Internal Review; K1, OW and C2 see C1's next Submitted item as the next number, with no gap", async () => {
    const first = await submitted("No gap: first");
    const cancelled = await cancelledInReview("No gap: cancelled in Internal Review");
    const next = await submitted("No gap: next");
    const firstNumber = (await stored(first)).document_number!;
    const nextNumber = (await stored(next)).document_number!;
    expect(seq(nextNumber), `${nextNumber} follows ${firstNumber}`).toBe(seq(firstNumber) + 1);
    expect((await stored(cancelled)).document_number).toBeNull();
    const { k1, ow, c2 } = tower;
    for (const as of [k1.members.manager, ow.members.representative]) {
      const seen = await listOf(as);
      expect(seen.find((r) => r.id === next), "reads the next item").toEqual({ id: next, document_number: nextNumber });
      // Every number they read anywhere runs on: none is missing between two they read.
      const theirs = (await numbersOf(as)).filter((n) => n.startsWith(firstNumber.slice(0, -4))).map(seq);
      for (let i = 1; i < theirs.length; i++) expect(theirs[i]! - theirs[i - 1]!, `${as}'s numbers run with no gap`).toBe(1);
    }
    const { c1 } = tower;
    await expectHiddenFrom({ label: "the cancelled one", read: listOf, target: cancelled, seenBy: c1.members.engineer, hiddenFrom: [k1.members.manager, ow.members.representative, c2.members.engineer] });
    // C2 reads none of C1's numbers (V3): each number as a row, read from the List and every event.
    const numberRows = async (as: string) => (await numbersOf(as)).map((n) => ({ id: n }));
    await expectHiddenFrom({ label: "C1's numbers", read: numberRows, target: nextNumber, seenBy: [c1.members.engineer, k1.members.manager, ow.members.representative], hiddenFrom: c2.members.engineer });
  });

  it("keeps the Creation Date column from the app role: a later grant fails here (RP-1316, Main 6)", async () => {
    const { rows } = await migrator.query("select has_column_privilege('rabaed_app', 'work_item', 'left_draft_at', 'select') as granted");
    expect(rows[0].granted).toBe(false);
  });

  it("RP-1316-2: before its first Submit, C1's item reaches nobody outside C1, with no number, count or gap", async () => {
    const id = await inReview("Before Submit: C1's own");
    const { c1, k1, ow, c2 } = tower;
    await expectHiddenFrom({
      label: "the List",
      read: listOf,
      target: id,
      seenBy: [c1.members.engineer, c1.members.project_manager],
      hiddenFrom: [k1.members.manager, k1.members.engineer, ow.members.representative, c2.members.engineer],
    });
    const events = (as: string) => tower.call<{ id: string }>(as, sql`select e.work_item_id as id from work_item_event e where e.work_item_id = ${id}::uuid`);
    await expectHiddenFrom({
      label: "its events",
      read: events,
      target: id,
      seenBy: [c1.members.engineer],
      hiddenFrom: [k1.members.manager, k1.members.engineer, ow.members.representative, c2.members.engineer],
    });
  });
});
