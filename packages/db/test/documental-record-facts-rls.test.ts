// Seam 2 for what the record job is told (app.documental_record_facts, as the worker: the app role
// with no Member set), scenarios RP-23-1, RP-23-2, RP-23-5, RP-650-1 and RP-1053-1 (RP-1083; spec
// RP-632; ADR 0022, ADR 0023; visibility.md V5, V7 and the Documental Record row). Seam 1 makes the
// PDF and its Record Data from these facts and reads them (documental-record.test.ts,
// documental-record-signatures.test.ts, company-stamp.test.ts); this file holds the facts
// themselves to what a record may print, so a change to the shared function fails here too.
//
// The facts list every Transition on the item, Returns included: which of them is on the path to
// the outcome is the worker's to say (recordPath). So here a move inside one Participant, and the
// Owner's review, give no answers and no Remarks, and nothing gives an Internal Note, a Return's
// reason, a Recommended Code or the Draft's start.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db, type RecordFacts } from "../src/index.ts";
import {
  addOwnerReviewWorkflow,
  addTestWorkflow,
  bilingual,
  buildSeamTwoTower,
  c2Draft,
  digits,
  testDatabaseUrls,
  wirAtConsultant,
  withSignature,
  withoutSignature,
  withoutStamp,
  type RunAsOwner,
  type SeamTwoTower,
} from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
/** An Inspection on the WIR Form whose Consultant review Recommends a Code to its manager (addTestWorkflow's `recommendCode`). */
const TYPE = `RF${letters(3)}`;
/** A submittal ending with the Owner's review (ADR 0022). */
const OWNER_TYPE = `RO${letters(3)}`;
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const verificationCode = () => Array.from({ length: 9 }, (_, i) => (i === 4 ? "-" : CODE_ALPHABET[randomInt(CODE_ALPHABET.length)])).join("");
const sha = (s: string) => createHash("sha256").update(s).digest();

const INTERNAL_NOTE = "Between us: the crew was rushed";
const RETURN_REASON = "Redo the calculation first";
const C1_RETURN_REASON = "Attach the method statement";
const RECOMMENDATION_REMARKS = "Our view for the Owner only";
const SENT_BACK_REMARKS = "The Owner sends this B back";
const SENT_BACK_COMMENT = "A Comment of the B sent back";

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RRF", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
/** OW's Project Manager, who holds the Owner's review (the Tower's Representative only views). */
let owPm = "";
const asOwner: RunAsOwner = (text, values) => migrator.query(text, values as unknown[]);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;

/** `as` takes `transition` on item `id` with `answers`, an Internal Note and a Recommended Code; returns the outcome. */
const takeWith = (as: string, id: string, transition: string, options: { answers?: object; note?: string; recommended?: string } = {}) =>
  tower.outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(options.answers ?? {})}::jsonb, ${options.note ?? ""},
      app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(), null, ${options.recommended ?? null}) as outcome`,
  );

/** The record job of closed item `id`. */
const recordJob = (id: string) => one("select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1", [id]);

/** What the record job of closed item `id` is told, read as the worker. */
async function factsOf(id: string): Promise<RecordFacts> {
  const outbox = await recordJob(id);
  const facts = (await sql<{ facts: RecordFacts | null }>`select app.documental_record_facts(${outbox}::uuid) as facts`.execute(app)).rows[0]!.facts;
  if (!facts) throw new Error(`no facts for ${id}`);
  return facts;
}

/** The record of closed item `id` saved and published as the worker does once its checks pass; returns its PDF's storage key. */
async function publish(id: string): Promise<string> {
  const outbox = await recordJob(id);
  const key = `projects/${tower.projectId}/work-items/${id}/documental-record/record.pdf`;
  const saved = await sql<{ saved: boolean }>`
    select app.save_documental_record(${outbox}::uuid, ${key}, ${sha(key)}, 10, ${key.replace("record.pdf", "record-data.xml")}, ${sha(id)}, 10,
      '1', 'bilingual', now(), ${sha(randomUUID())}, ${verificationCode()}) as saved`.execute(app);
  expect(saved.rows[0]!.saved).toBe(true);
  const finished = await sql<{ done: boolean }>`select app.finish_documental_record(${outbox}::uuid, true, '[]'::jsonb) as done`.execute(app);
  expect(finished.rows[0]!.done).toBe(true);
  return key;
}

/** The record's PDF key `as` gets for item `id` (app.documental_record_file): none where they don't see it. */
const recordFile = (as: string, id: string) =>
  withMember(app, as, (trx) => sql<{ storage_key: string }>`select storage_key from app.documental_record_file(${id}::uuid)`.execute(trx)).then((r) =>
    r.rows.map((row) => row.storage_key),
  );

/** Every string in `value`, with where it is, leaving out `skip`'s keys. */
function strings(value: unknown, skip: readonly string[] = [], path = "$"): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, skip, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (skip.includes(k) ? [] : strings(v, skip, `${path}.${k}`)));
  }
  return [];
}

/** When item `id`'s Draft was started, as the facts would write a time. */
const draftStart = async (id: string) =>
  (await migrator.query<{ at: string }>("select app.iso_utc(created_at) as at from work_item where id = $1", [id])).rows[0]!.at;

/** C1's Engineer raises item of `type` on the Tower's Trade and Building A, with `data`; returns its id. */
async function raise(type: string, title: string, data: object): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify(data)}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** C1 Submits Owner's-review item `id` and K1's Manager picks it up at the Consultant PM's Step. */
async function ownerReviewAtK1(title: string): Promise<string> {
  const id = await raise(OWNER_TYPE, title, { model: title });
  expect(await tower.take(tower.c1.members.engineer, id, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(tower.c1.members.project_manager, id)).toBe("picked_up");
  expect(await tower.take(tower.c1.members.project_manager, id, "submit")).toBe("applied");
  expect(await tower.pickUp(tower.k1.members.manager, id)).toBe("picked_up");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  const workflowId = await addTestWorkflow(run, { name: bilingual(`RP-1083 record facts ${digits(6)}`), recommendCode: true });
  const wirFormId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-1083)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [wirFormId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-1083)")), workflowId, wirFormId],
  );

  const ownerWorkflowId = await addOwnerReviewWorkflow(run);
  const ownerFormId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Owner review (RP-1083)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    ownerFormId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [OWNER_TYPE, JSON.stringify(bilingual("Owner review (RP-1083)")), ownerWorkflowId, ownerFormId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  // OW's Project Manager holds the Owner's review: the Tower's Representative only views.
  owPm = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
    tower.ow.id,
    `ow-pm-${randomUUID().slice(0, 8)}@rabaed.test`,
    JSON.stringify(bilingual("project_manager")),
  ]);
  await tower.call(tower.ow.ap, sql<{ outcome: string }>`select app.add_project_member(${tower.ow.participantId}::uuid, ${owPm}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(
      await tower.outcome(tower.ow.ap, sql`select app.set_member_visibility(${tower.ow.participantId}::uuid, ${owPm}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
    ).toBe("set");
  }
  expect(
    await tower.outcome(tower.ow.ap, sql`select app.set_project_member_positions(${tower.ow.participantId}::uuid, ${owPm}::uuid, ${["project_manager"]}::text[]) as outcome`),
  ).toBe("set");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-23-1: K1's PM issues Code A on C1's item; the record is made", () => {
  let id = "";
  let facts: RecordFacts;
  let key = "";

  beforeAll(async () => {
    const { k1 } = tower;
    id = await wirAtConsultant(tower, { type: TYPE, title: "Slab pour, Level 1" });
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { recommended: "A" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "approve_a")).toBe("applied");
    // K1's Manager adds a new Signature after the close: the facts keep the one in force when they acted.
    await withSignature(asOwner, k1.members.manager);
    facts = await factsOf(id);
    key = await publish(id);
  });

  it("name C1's and K1's actors, each with their Company and the Signature their event recorded", () => {
    const { c1, k1 } = tower;
    expect(facts.outcome).toBe("A");
    expect(facts.transitions.map((t) => [t.companyName.en, t.memberName.en, t.kind])).toEqual([
      ["C1", "engineer", "send"],
      ["C1", "project_manager", "submit"],
      ["K1", "engineer", "send"],
      ["K1", "manager", "close"],
    ]);
    const actors = [c1.members.engineer, c1.members.project_manager, k1.members.engineer, k1.members.manager];
    expect(facts.transitions.map((t) => t.signature?.storageKey)).toEqual(actors.map((m) => `members/${m}/signatures/test-default.png`));
  });

  it("give the Owner's, K1's and C1's Stamps in force at the close, and never name C2", () => {
    const { c1, k1, ow, c2 } = tower;
    expect(facts.companies.map((c) => [c.participantId, c.name.en, c.stamp?.storageKey, c.logo])).toEqual([
      [ow.participantId, "OW", `companies/${ow.id}/stamp/test-default.png`, null],
      [k1.participantId, "K1", `companies/${k1.id}/stamp/test-default.png`, null],
      [c1.participantId, "C1", `companies/${c1.id}/stamp/test-default.png`, null],
    ]);
    const text = JSON.stringify(facts);
    for (const hidden of [c2.id, c2.participantId, c2.members.engineer]) expect(text).not.toContain(hidden);
  });

  it("C1, K1 and the Owner get the same record file once it is published; C2 gets none, and gets its own item's", async () => {
    const { c1, k1, ow, c2 } = tower;
    for (const reader of [c1.members.project_manager, c1.members.engineer, k1.members.engineer, k1.members.manager, ow.members.representative]) {
      expect(await recordFile(reader, id), reader).toEqual([key]);
    }
    expect(await recordFile(c2.members.engineer, id)).toEqual([]);
    expect(await recordFile(c2.members.engineer, randomUUID())).toEqual([]);
    // Positive control: C2 reads the record of an item it sees (the owner gives C2's own Draft one).
    const own = await c2Draft(tower, { type: "WIR", title: "Column pour" });
    const ownKey = `projects/${tower.projectId}/work-items/${own}/documental-record/record.pdf`;
    const file = async (k: string, mime: string) => one("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime]);
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code)
       values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, $7)`,
      [tower.projectId, own, await file(ownKey, "application/pdf"), await file(`${ownKey}.xml`, "application/xml"), sha("pdf"), sha(randomUUID()), verificationCode()],
    );
    expect(await recordFile(c2.members.engineer, own)).toEqual([ownKey]);
  });
});

describe("scenarios RP-23-2 and RP-1053-1: a Returned send, a Recommended Code C and a Return in K1, then Code A", () => {
  let id = "";
  let facts: RecordFacts;

  beforeAll(async () => {
    const { c1, k1 } = tower;
    id = await raise(TYPE, "Slab pour, Level 2", { checklist_template: tower.checklistVersionId });
    expect(await tower.outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
    // C1's Engineer sends it, the PM Returns it with a reason, the Engineer sends it again and the PM Submits it (RP-1053).
    expect(await takeWith(c1.members.engineer, id, "send_for_review", { note: INTERNAL_NOTE })).toBe("applied");
    expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await takeWith(c1.members.project_manager, id, "return", { note: C1_RETURN_REASON })).toBe("applied");
    expect(await takeWith(c1.members.engineer, id, "send_for_review")).toBe("applied");
    expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
    // K1's Engineer recommends C with an Internal Note; the Manager Returns it, the Engineer recommends C again, the Manager issues A.
    expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { note: INTERNAL_NOTE, recommended: "C" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "return_to_engineer", { note: RETURN_REASON })).toBe("applied");
    expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { note: INTERNAL_NOTE, recommended: "C" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "approve_a")).toBe("applied");
    facts = await factsOf(id);
  });

  it("RP-23-2: give no C anywhere but among the outcomes the Final decision's chips print", () => {
    expect(facts.outcome).toBe("A");
    expect(facts.outcomes.map((o) => o.code)).toContain("C");
    expect(strings(facts, ["outcomes"]).filter(([, v]) => v === "C")).toEqual([]);
    // A Step's outcome mode (`recommend_code`) is the Workflow's, which the record reads to name the issuer; never a Recommended Code.
    expect(strings(facts, ["outcomes", "outcomeMode"]).filter(([, v]) => /recommend/i.test(v))).toEqual([]);
  });

  it("RP-23-2: give no Internal Note, no Return's reason, and no answers for a move inside one Participant", () => {
    const text = JSON.stringify(facts);
    for (const hidden of [INTERNAL_NOTE, RETURN_REASON, C1_RETURN_REASON]) expect(text, hidden).not.toContain(hidden);
    const inside = facts.transitions.filter((t) => t.kind === "send" || t.kind === "return");
    expect(inside.map((t) => [t.companyName.en, t.kind])).toEqual([
      ["C1", "send"],
      ["C1", "return"],
      ["C1", "send"],
      ["K1", "send"],
      ["K1", "return"],
      ["K1", "send"],
    ]);
    for (const move of inside) expect([move.answers, move.remarks], move.label.en).toEqual([null, null]);
  });

  it("RP-23-2: never give the Draft's start", async () => {
    const started = await draftStart(id);
    expect(JSON.stringify(facts)).not.toContain(started);
    expect(facts.transitions[0]!.at > started).toBe(true);
  });

  it("RP-1053-1: give both of C1's sends in order, the Returned one before the Return and the one on the path after it", () => {
    const c1Moves = facts.transitions.filter((t) => t.companyName.en === "C1");
    expect(c1Moves.map((t) => t.kind)).toEqual(["send", "return", "send", "submit"]);
    const [returned, back, again] = c1Moves;
    expect(returned!.at < back!.at && back!.at < again!.at).toBe(true);
  });
});

describe("scenario RP-23-2: the Owner sends a Code B back and confirms the Code D that follows", () => {
  let id = "";
  let facts: RecordFacts;

  beforeAll(async () => {
    const { k1 } = tower;
    id = await ownerReviewAtK1("Cable trays");
    expect(
      await takeWith(k1.members.manager, id, "recommend_b", { answers: { remarks: SENT_BACK_REMARKS, items_to_create: [{ comment: SENT_BACK_COMMENT }] } }),
    ).toBe("applied");
    expect(await tower.pickUp(owPm, id)).toBe("picked_up");
    expect(await takeWith(owPm, id, "owner_send_back", { note: INTERNAL_NOTE })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "recommend_d")).toBe("applied");
    expect(await tower.pickUp(owPm, id)).toBe("picked_up");
    expect(await takeWith(owPm, id, "confirm_d")).toBe("applied");
    facts = await factsOf(id);
  });

  it("give the D the Owner confirmed, and nothing of the B it sent back: no Remarks, no Comments, no B", () => {
    expect(facts.outcome).toBe("D");
    const text = JSON.stringify(facts);
    for (const hidden of [SENT_BACK_REMARKS, SENT_BACK_COMMENT, INTERNAL_NOTE]) expect(text, hidden).not.toContain(hidden);
    expect(facts.comments).toEqual([]);
    expect(facts.reviewComments).toBe(0);
    expect(strings(facts, ["outcomes"]).filter(([, v]) => v === "B")).toEqual([]);
  });

  it("give no answers and no Remarks for the Owner's review's moves, internal to K1 and the Owner", () => {
    const review = facts.transitions.filter((t) => t.companyName.en !== "C1");
    expect(review.map((t) => [t.companyName.en, t.kind])).toEqual([
      ["K1", "submit"],
      ["OW", "send_back"],
      ["K1", "submit"],
      ["OW", "close"],
    ]);
    for (const move of review) expect([move.answers, move.remarks], move.label.en).toEqual([null, null]);
  });

  it("never give the Draft's start", async () => {
    expect(JSON.stringify(facts)).not.toContain(await draftStart(id));
  });
});

describe("scenario RP-650-1: K1's PM recommends Code B to the Owner with Remarks and a Comment; the Owner confirms it", () => {
  let facts: RecordFacts;

  beforeAll(async () => {
    const id = await ownerReviewAtK1("Switchgear");
    expect(
      await takeWith(tower.k1.members.manager, id, "recommend_b", {
        answers: { remarks: RECOMMENDATION_REMARKS, items_to_create: [{ comment: "Fix the gland plate" }] },
      }),
    ).toBe("applied");
    expect(await tower.pickUp(owPm, id)).toBe("picked_up");
    expect(await takeWith(owPm, id, "confirm_b")).toBe("applied");
    facts = await factsOf(id);
  });

  it("never give the Recommendation's Remarks: not as its answers, not as a Code's Remarks, nowhere", () => {
    expect(facts.outcome).toBe("B");
    expect(JSON.stringify(facts)).not.toContain(RECOMMENDATION_REMARKS);
    const recommendation = facts.transitions.find((t) => t.companyName.en === "K1")!;
    expect([recommendation.kind, recommendation.answers, recommendation.remarks]).toEqual(["submit", null, null]);
    // The Owner's Confirm asks nothing, so page 1 has no reply to print.
    expect(facts.transitions.map((t) => t.remarks)).toEqual(facts.transitions.map(() => null));
  });

  it("still give the Comments the Code raised, by K1", () => {
    expect(facts.comments.map((c) => [c.comment, c.companyName.en])).toEqual([["Fix the gland plate", "K1"]]);
  });
});

describe("scenario RP-23-5: C1 has no Stamp until its Authorized Person adds one; no logo is needed", () => {
  let id = "";
  let stampKey = "";
  let facts: RecordFacts;
  const written = async () =>
    (
      await migrator.query<{ events: number; notices: number }>(
        `select (select count(*)::int from work_item_event where work_item_id = $1) as events,
                (select count(*)::int from notification where work_item_id = $1) as notices`,
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    id = await raise(TYPE, "Slab pour, Level 3", { checklist_template: tower.checklistVersionId });
    expect(await tower.outcome(tower.c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
    await withoutStamp(asOwner, tower.c1.id);
  });

  it("refuses C1's Engineer no_stamp, after no_signature, writing nothing and telling nobody; C2 gets the plain not_found", async () => {
    const { c1, c2 } = tower;
    const before = await written();
    expect(await tower.take(c1.members.engineer, id, "send_for_review")).toBe("no_stamp");
    await withoutSignature(asOwner, c1.members.engineer);
    expect(await tower.take(c1.members.engineer, id, "send_for_review")).toBe("no_signature");
    await withSignature(asOwner, c1.members.engineer);
    expect(await tower.take(c2.members.engineer, id, "send_for_review")).toBe("not_found");
    expect(await written()).toEqual(before);
    // C1's own Company state, read for the acting Member only.
    expect(await tower.outcome(c1.members.engineer, sql`select app.member_company_has_stamp(${c1.members.engineer}::uuid)::text as outcome`)).toBe("false");
  });

  it("lets the Engineer take it once C1's Authorized Person adds the Stamp; the facts give that Stamp and no logo", async () => {
    const { c1, k1 } = tower;
    stampKey = `companies/${c1.id}/stamp/${randomUUID()}.png`;
    expect(
      await tower.outcome(c1.ap, sql`select app.set_company_image(${c1.id}::uuid, 'stamp', ${stampKey}, ${sha(stampKey)}, ${2048}, 'image/png', now()) as outcome`),
    ).toBe("set");
    expect(await tower.take(c1.members.engineer, id, "send_for_review")).toBe("applied");
    expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
    expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { recommended: "A" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "approve_a")).toBe("applied");
    facts = await factsOf(id);
    const own = facts.companies.find((c) => c.participantId === c1.participantId)!;
    expect([own.stamp?.storageKey, own.logo]).toEqual([stampKey, null]);
  });
});
