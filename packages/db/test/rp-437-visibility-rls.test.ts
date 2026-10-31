// Seam 2 for scenario RP-437-1 (RP-437, WF-14; ADR 0019, ADR 0020; workflow-engine.md §5.7; visibility.md V5,
// V14), as the app role: a MAR on the Rabaed Default MAR Workflow Version 3 and MAR Form Version 5, which the
// migrations add. C1's PM Returns it to C1's engineer once, then Submits it with a Cover Note and an Internal
// Note; K1's engineer replies (Send to Manager) with the verification, a Recommended Code and an Internal Note;
// K1's manager issues Code C with the final verification and Remarks.
//
// K1 and O1 (an Owner Representative, oversight) read the Submit and its Cover Note, by C1's Company with no
// person, never C1's Internal Note or Return. C1 and O1 read nothing of K1's reply, its Recommended Code or
// Internal Note, before or after the Code; K1's manager reads K1's own reply, which the Code pop-up starts from.
// After the Code, C1 and O1 read the Code, its Remarks and final verification, and that K1's manager issued it.
// C2 reads nothing of the item, while it reads its own Draft. Seam 1: apps/api/test/mar-v3.test.ts.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, joinProject, sha256Bytea, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RMV", k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;

const COVER_NOTE = "Covers Level 2 only";
const C1_NOTE = "PM: quantities checked against BOQ";
const RETURN_REASON = "Use the 2026 datasheet";
const K1_NOTE = "Engineer: compared with the approved sample";
const verified = { sample_checked: true, matches_specification: true };
const notMatching = { sample_checked: true, matches_specification: false, verification_note: "Wrong colour temperature" };
const REMARKS = "Resubmit with 4000 K";

let migrator: pg.Client;
let app: Db;
let tower: Tower;
let call: Tower["call"];
let outcome: Tower["outcome"];
let engineer = ""; // C1's engineer: the author.
let pm = ""; // C1's PM: holds Contractor PM.
let k1Engineer = ""; // K1's engineer: the Consultant Engineer Step's pool.
let k1Manager = ""; // K1's manager: issues the Code.
let o1 = ""; // O1's engineer: an Owner Representative with oversight.
let c2 = ""; // C2's engineer: another Contractor, in Building B only.
let c2Own = ""; // C2's own Draft: the positive control beside every refusal to C2.
let id = "";

/** `as` takes `transition` on item `id` with `answers`, an Internal Note and a Recommended Code. */
const take = (as: string, transition: string, options: { answers?: object; note?: string; recommended?: string } = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(options.answers ?? {})}::jsonb, ${options.note ?? ""},
      app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(), null, ${options.recommended ?? null}) as outcome`,
  );
/** `as` holds the item's current Step: at once as its pool's only Member, or by picking it up. */
async function hold(as: string) {
  const { rows } = await migrator.query("select assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up', 'vacant')", [id]);
  if (rows.some((r) => r.assignee_member_id === as)) return;
  expect(await tower.pickUp(as, id)).toBe("picked_up");
}
/** The id of item `id`'s one event that `where` (SQL over `e`, the event, and `t`, its Transition) picks, read as the migrator. */
async function eventWhere(where: string, value: string): Promise<string> {
  const { rows } = await migrator.query(
    `select e.id from work_item_event e left join workflow_transition t on t.id = e.transition_id where e.work_item_id = $1 and ${where} = $2`,
    [id, value],
  );
  expect(rows, `${where} = ${value}`).toHaveLength(1); // not hidden-from: setup, read as the migrator: the event exists, once
  return rows[0].id as string;
}
const eventById = (event: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item_event where id = ${event}::uuid`);
type HistoryRow = { type: string; company_name: unknown; member_name: unknown; reason: string | null; outcome: string | null; internal_note: string | null; remarks: string | null; recommended_code: string | null; answers: Record<string, unknown> | null };
const history = (as: string) =>
  call<HistoryRow>(as, sql`select type, company_name, member_name, reason, outcome, internal_note, remarks, recommended_code, answers from app.work_item_history(${id}::uuid)`);

/** A Company of `name` with its Authorized Person and one engineer, joined to the Project as `role`, seeing everything. */
async function joinedCompany(name: string, role: string): Promise<string> {
  const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;
  const memberOf = (companyId: string, who: string, creator: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      `${who}-${randomUUID().slice(0, 8)}@rabaed.test`,
      JSON.stringify(bilingual(who)),
      creator,
    ]);
  const cr = digits(10);
  const onboardedBy = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [`eng-${randomUUID().slice(0, 8)}@rabaed.test`]);
  const companyId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify(bilingual(name)),
    cr,
    `3${digits(13)}3`,
    onboardedBy,
  ]);
  const ap = await memberOf(companyId, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
  const participant = await joinProject(app, tower.projectId, { adminId: tower.c1.ap, crNumber: cr, role }, ap);
  for (const kind of ["trade", "location"]) {
    expect(await outcome(tower.c1.ap, sql`select app.set_participant_visibility(${participant}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  const memberId = await memberOf(companyId, "engineer", false);
  await call(ap, sql<{ outcome: string }>`select app.add_project_member(${participant}::uuid, ${memberId}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await outcome(ap, sql`select app.set_member_visibility(${participant}::uuid, ${memberId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await outcome(ap, sql`select app.set_project_member_positions(${participant}::uuid, ${memberId}::uuid, ${["engineer"]}::text[]) as outcome`)).toBe("set");
  return memberId;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  ({ call, outcome } = tower);
  engineer = tower.c1.members.engineer;
  pm = tower.c1.members.project_manager;
  k1Engineer = tower.k1.members.engineer;
  k1Manager = tower.k1.members.manager;
  c2 = tower.c2.members.engineer;
  o1 = await joinedCompany("O1", "owner_representative");
  c2Own = await c2Draft(tower, { type: "MAR", title: "C2's own MAR" });

  // The MAR runs the Rabaed Default MAR Workflow Version 3 on the Form Version 5.
  const [supplier] = await call<{ outcome: string; supplier_id: string }>(
    tower.c1.ap,
    sql`select outcome, supplier_id from app.add_approved_supplier(${tower.projectId}::uuid, ${tower.tradeId}::uuid, null, ${JSON.stringify(bilingual("Philips Lighting"))}::jsonb, now())`,
  );
  expect(supplier!.outcome).toBe("added");
  const answers = {
    manufacturer: "Philips",
    supplier: supplier!.supplier_id,
    model: "Visibility",
    description: "LED panels",
    items: [{ fixture_type: "Recessed panel", quantity: 10, unit: "pcs" }],
  };
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'MAR', 'Visibility', app.latest_form_version('MAR'), ${JSON.stringify(answers)}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  id = created!.work_item_id;
  const { rows: pinned } = await migrator.query(
    `select v.version_no as workflow, f.version_no as form from work_item w join workflow_version v on v.id = w.workflow_version_id
     join form_version f on f.id = w.form_version_id where w.id = $1`,
    [id],
  );
  expect(pinned).toEqual([{ workflow: 3, form: 5 }]);
  const [started] = await call<{ outcome: string; document_id: string }>(
    engineer,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'datasheet.pdf', 10, 'application/pdf', now(), 'datasheet')`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await outcome(engineer, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${sha256Bytea("datasheet")}, now()) as outcome`),
  ).toBe("confirmed");

  // C1's PM Returns it to C1's engineer once (inside C1), then Submits it with the Cover Note and an Internal Note.
  expect(await take(engineer, "send_for_review")).toBe("applied");
  await hold(pm);
  expect(await take(pm, "return", { answers: { reason: RETURN_REASON } })).toBe("applied");
  await hold(engineer);
  expect(await take(engineer, "send_for_review_again")).toBe("applied");
  await hold(pm);
  expect(await take(pm, "submit", { answers: { cover_note: COVER_NOTE }, note: C1_NOTE })).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-437-1: who reads the replies of a MAR on the MAR Workflow Version 3", () => {
  let c1Before: { engineer: HistoryRow[]; pm: HistoryRow[]; o1: HistoryRow[] };

  it("K1 and O1 read the Submit and its Cover Note by C1's Company, with no person; C2 reads no part of the item", async () => {
    const submit = await eventWhere("e.type = 'transition' and t.key", "submit");
    await expectHiddenFrom({ read: eventById(submit), target: submit, seenBy: [engineer, pm, k1Engineer, k1Manager, o1], hiddenFrom: c2, label: "the Submit" });
    for (const who of [k1Engineer, k1Manager, o1]) {
      const row = (await history(who)).find((e) => e.answers?.cover_note !== undefined);
      expect(row, who).toMatchObject({ answers: { cover_note: COVER_NOTE }, member_name: null });
      expect(row!.company_name, who).not.toBeNull();
    }
    // C1 reads its own PM by name on the same event.
    expect((await history(engineer)).find((e) => e.answers?.cover_note !== undefined)!.member_name).toEqual(bilingual("project_manager"));
    // C2 reaches its own MAR, so its refusal of C1's is V3 (RP-995).
    const byId = (item: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`);
    await expectHiddenFrom({ read: byId(c2Own), target: c2Own, seenBy: c2, hiddenFrom: [engineer, k1Engineer, o1], label: "C2's own Draft" });
    await expectHiddenFrom({ read: byId(id), target: id, seenBy: [engineer, k1Engineer, k1Manager, o1], hiddenFrom: c2, label: "the MAR" });
  });

  it("K1 and O1 never read C1's Internal Note or its Return", async () => {
    const c1Only = { seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, o1, c2] };
    const note = await eventWhere("e.payload ->> 'internal_note'", C1_NOTE);
    await expectHiddenFrom({ read: eventById(note), target: note, ...c1Only, label: "C1's Internal Note" });
    const back = await eventWhere("e.type = 'transition' and t.key", "return");
    await expectHiddenFrom({ read: eventById(back), target: back, ...c1Only, label: "C1's Return" });
    // Through the history too, where each is the one row holding its text.
    const notes = (as: string) => history(as).then((rows) => rows.map((r) => ({ id: r.internal_note ?? "" })));
    await expectHiddenFrom({ read: notes, target: C1_NOTE, ...c1Only, label: "C1's Internal Note in the history" });
    const reasons = (as: string) => history(as).then((rows) => rows.map((r) => ({ id: r.reason ?? "" })));
    await expectHiddenFrom({ read: reasons, target: RETURN_REASON, ...c1Only, label: "C1's Return reason in the history" });
  });

  it("K1's engineer replies; C1 and O1 read nothing of it, the Recommended Code or its Internal Note, and their history is unchanged", async () => {
    c1Before = { engineer: await history(engineer), pm: await history(pm), o1: await history(o1) };
    await hold(k1Engineer);
    expect(await take(k1Engineer, "send_to_manager", { answers: notMatching, note: K1_NOTE, recommended: "C" })).toBe("applied");
    expect({ engineer: await history(engineer), pm: await history(pm), o1: await history(o1) }).toEqual(c1Before);
    await expectK1ReplyInsideK1();
    // K1's manager reads K1's own reply, which the Code pop-up starts from (`prefill`).
    const reply = await eventWhere("e.type", "internal_answers");
    expect(await call(k1Manager, sql<{ payload: unknown }>`select payload from work_item_event where id = ${reply}::uuid`)).toEqual([{ payload: { answers: notMatching } }]);
  });

  it("after K1's manager issues Code C, C1 and O1 read the Code, its Remarks and final verification, and who issued it; still nothing of K1's reply", async () => {
    await hold(k1Manager);
    expect(await take(k1Manager, "revise_c", { answers: { ...verified, remarks: REMARKS } })).toBe("applied");
    const code = await eventWhere("e.type", "issue_code");
    await expectHiddenFrom({ read: eventById(code), target: code, seenBy: [engineer, pm, o1, k1Engineer], hiddenFrom: c2, label: "the Code" });
    const managerName = (await migrator.query("select full_name from member where id = $1", [k1Manager])).rows[0].full_name as unknown;
    for (const who of [engineer, pm, o1]) {
      expect((await history(who)).at(-1), who).toMatchObject({
        type: "issue_code",
        outcome: "C",
        remarks: REMARKS,
        answers: { ...verified, remarks: REMARKS },
        member_name: managerName,
      });
    }
    await expectK1ReplyInsideK1();
  });

  /** K1's reply (its internal answers), its Recommended Code and its Internal Note: K1's Members read each, by id; C1, O1 and C2 none. */
  async function expectK1ReplyInsideK1() {
    const k1Only = { seenBy: [k1Engineer, k1Manager], hiddenFrom: [engineer, pm, o1, c2] };
    for (const [what, where, value] of [
      ["K1's reply", "e.type", "internal_answers"],
      ["K1's Recommended Code", "e.type", "recommend_code"],
      ["K1's Internal Note", "e.payload ->> 'internal_note'", K1_NOTE],
    ] as const) {
      const event = await eventWhere(where, value);
      await expectHiddenFrom({ read: eventById(event), target: event, ...k1Only, label: what });
    }
    // Through the history too: the item has one reply and one recommendation, so each is the one row of its type.
    const types = (as: string) => history(as).then((rows) => rows.map((r) => ({ id: r.type })));
    for (const type of ["internal_answers", "recommend_code"]) await expectHiddenFrom({ read: types, target: type, ...k1Only, label: `the history's ${type}` });
    const notes = (as: string) => history(as).then((rows) => rows.map((r) => ({ id: r.internal_note ?? "" })));
    await expectHiddenFrom({ read: notes, target: K1_NOTE, ...k1Only, label: "K1's Internal Note in the history" });
  }
});
