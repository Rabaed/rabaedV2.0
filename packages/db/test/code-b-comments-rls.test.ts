// Seam 2 for Code B's Comments (RP-434, WF-11; workflow-engine.md §6; visibility.md
// V1, V2, V3, V5 and scenarios RP-434-1 to RP-434-3), as the app role. Code B's rows
// become Comments that reach exactly the Participants and Members who see the
// reviewed item: the Contractor that raised it holds them, the Consultant that raised
// them and the Owner Representative overseeing it read them, another Contractor never
// does, nor a Member whose Visibility doesn't cover them; the reviewed item's Comment
// counts follow the same rows. The reviewer's own record of raising them stays its own (V5).
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "CBRLS";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the reviewed item, holds its Comments.
let k1: Company; // Consultant: reviews it with Code B, raising the Comments.
let c2: Company; // Another Contractor of the same Trade (V3).
let or: Company; // Owner Representative: oversight of Submitted items (V2).
let c1Pm = "";
let k1Mechanical = ""; // A K1 engineer whose Visibility covers Mechanical only (layer 4).
let projectId = "";
let electrical = "";
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
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** The items `as` sees of `ids`. */
const seen = async (as: string, ids: string[]) =>
  (await call<{ id: string }>(as, sql`select id from work_item where id = any(${ids}::uuid[]) order by id`)).map((r) => r.id);
/** The reviewed item's Comment counts as `as` reads them: none for an item they don't see. */
const counts = (as: string, id: string) =>
  call<{ open_count: number; closed_count: number }>(as, sql`select open_count, closed_count from app.work_item_comment_counts(${id}::uuid)`);

// Reads for expectHiddenFrom (RP-1095): each gives the rows `as` reads, by id.
/** Item `id`, if `as` sees it. */
const itemOf = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);
/** The Links from item `id` that `as` reads. */
const linksFrom = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item_link where from_id = ${id}::uuid`);
/** The events of item `id` that `as` reads. */
const eventsOf = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item_event where work_item_id = ${id}::uuid`);
/** Item `id`'s Comment counts, as the item's id when `as` reads them. */
const countsOf = (id: string) => async (as: string) => (await counts(as, id)).map(() => ({ id }));
/** The migrator's one row of `query`'s id. */
const idOf = async (query: string, values: unknown[]) => (await migrator.query<{ id: string }>(query, values)).rows[0]!.id;
const whoIs = (as: string) =>
  ({ [c1.member]: "C1 engineer", [c1Pm]: "C1 PM", [k1.member]: "K1 engineer", [k1.ap]: "K1 manager", [k1Mechanical]: "K1 Mechanical engineer", [c2.member]: "C2", [or.member]: "OR" })[as] ?? as;

/** C1's item, Submitted, then closed by K1's engineer with Code B and these rows: the reviewed item and its Comments. */
async function closedAtB(model: string, rows: { comment: string }[]): Promise<{ source: string; comments: string[] }> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  const source = created!.work_item_id;
  expect(await take(c1.member, source, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, source)).toBe("picked_up");
  expect(await take(c1Pm, source, "submit")).toBe("applied");
  expect(await pickUp(k1.member, source)).toBe("picked_up");
  expect(await take(k1.member, source, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1.ap, source)).toBe("picked_up");
  expect(await take(k1.ap, source, "approve_b", { items_to_create: rows })).toBe("applied");
  const { rows: links } = await migrator.query<{ id: string }>(
    "select from_id as id from work_item_link where to_id = $1 and kind = 'raised_from' order by from_id",
    [source],
  );
  return { source, comments: links.map((l) => l.id) };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withApproveB: true });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Code B (test)", "ar": "الرمز B"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "model", "type": "text", "label": {"en": "Model", "ar": "الطراز"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Code B (test)", "ar": "الرمز B"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  or = await company(engineer, "OR");
  c1Pm = await member(c1.id, "pm");
  k1Mechanical = await member(k1.id, "mechanical");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'CBT', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
    or: await joinProject(app, projectId, { adminId: c1.ap, crNumber: or.cr, role: "owner_representative" }, or.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  mechanical = await value("trade", "ME");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[], string[] | null][] = [
    [c1, participant.c1, c1.member, ["engineer"], null],
    [c1, participant.c1, c1Pm, ["project_manager"], null],
    [k1, participant.k1, k1.member, ["engineer"], null],
    [k1, participant.k1, k1.ap, ["manager"], null],
    [k1, participant.k1, k1Mechanical, ["engineer"], [mechanical]],
    [c2, participant.c2, c2.member, ["engineer"], null],
    [or, participant.or, or.member, ["engineer"], null],
  ];
  for (const [co, p, m, positions, trades] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      const onlyThese = kind === "trade" && trades !== null;
      expect(
        await outcome(
          co.ap,
          sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, ${!onlyThese}, ${onlyThese ? trades : []}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Code B's Comments reach exactly who sees the reviewed item", () => {
  it("makes one Comment per row, raised by K1, held by C1's Step Pool, Open", async () => {
    const { comments } = await closedAtB("Rows", [{ comment: "One" }, { comment: "Two" }]);
    expect(comments).toHaveLength(2); // not hidden-from: the migrator's count of the Comments made, one per row
    const { rows } = await migrator.query<{ raiser: string; holder: string; stage: string; title: string }>(
      `select rp.company_id as raiser, ap.company_id as holder, w.current_stage_key as stage, w.title
       from work_item w
       join participant rp on rp.id = w.raised_by_participant_id
       join step_assignment a on a.work_item_id = w.id and a.status = 'pooled'
       join participant ap on ap.id = a.participant_id
       where w.id = any($1::uuid[]) order by w.title`,
      [comments],
    );
    expect(rows).toEqual([
      { raiser: k1.id, holder: c1.id, stage: "open", title: "One" },
      { raiser: k1.id, holder: c1.id, stage: "open", title: "Two" },
    ]);
  });

  it("takes from a row only the fields the reviewer fills at the Draft, never the Contractor's Resolution (WF-8)", async () => {
    const { comments } = await closedAtB("Pre-filled", [{ comment: "Mine", resolution_note: "Already done" } as { comment: string }]);
    const { rows } = await migrator.query<{ data: Record<string, unknown> }>("select data from work_item where id = $1", [comments[0]]);
    expect(rows[0]!.data).toEqual({ comment: "Mine" });
  });

  it("RP-434-1: C2, another Contractor of the same Trade, reads none of them, their Links or their count", async () => {
    const { source, comments } = await closedAtB("Hidden from C2", [{ comment: "Only C1's" }]);
    const comment = comments[0]!;
    // C1, which holds it, and K1, which raised it, read each first, so C2's reads are no empty reads.
    const hidden = { seenBy: [c1.member, k1.member], hiddenFrom: c2.member, name: whoIs };
    await expectHiddenFrom({ ...hidden, read: itemOf(comment), target: comment, label: "the Comment" });
    const link = await idOf("select id from work_item_link where from_id = $1 and kind = 'raised_from'", [comment]);
    await expectHiddenFrom({ ...hidden, read: linksFrom(comment), target: link, label: "its Link" });
    const raise = await idOf("select id from work_item_event where work_item_id = $1 and type = 'transition' order by seq limit 1", [comment]);
    await expectHiddenFrom({ ...hidden, read: eventsOf(comment), target: raise, label: "its Raise" });
    await expectHiddenFrom({ ...hidden, read: countsOf(source), target: source, label: "the reviewed item's counts" });
  });

  it("RP-434-2: K1 sees the Comments it raised, C1 holds them, the Owner Representative oversees them; each reads the shared Raise", async () => {
    const { source, comments } = await closedAtB("Seen", [{ comment: "Seen by all three" }]);
    for (const who of [k1.member, c1.member, or.member]) {
      expect(await seen(who, comments)).toEqual(comments);
      expect(await counts(who, source)).toEqual([{ open_count: 1, closed_count: 0 }]);
      // Its history starts at the Raise, shared; its `created` event is nobody's (Creation Date).
      expect(await call(who, sql<{ type: string }>`select type from work_item_event where work_item_id = ${comments[0]}::uuid order by seq`)).toEqual([{ type: "transition" }]);
    }
  });

  it("RP-434-3: counts only the Comments the Member sees: K1's Mechanical-only engineer sees neither the item nor its Comments", async () => {
    const { source, comments } = await closedAtB("Electrical only", [{ comment: "Not for Mechanical" }]);
    // K1's engineer covering everything reads each; the Mechanical-only one reads none.
    const hidden = { seenBy: k1.member, hiddenFrom: k1Mechanical, name: whoIs };
    for (const id of [source, ...comments]) await expectHiddenFrom({ ...hidden, read: itemOf(id), target: id, label: "an Electrical item" });
    await expectHiddenFrom({ ...hidden, read: countsOf(source), target: source, label: "the reviewed item's counts" });
    // A Comment closed counts as closed, for everyone who sees it.
    expect(await pickUp(c1Pm, comments[0]!)).toBe("picked_up");
    // The resolution note is C1's reply, in the Resolve Screen (RP-437, ADR 0019).
    expect(await take(c1Pm, comments[0]!, "resolve", { resolution_note: "Done" })).toBe("applied");
    expect(await pickUp(k1.member, comments[0]!)).toBe("picked_up");
    expect(await take(k1.member, comments[0]!, "close")).toBe("applied");
    expect(await counts(c1.member, source)).toEqual([{ open_count: 0, closed_count: 1 }]);
    expect(await counts(k1.member, source)).toEqual([{ open_count: 0, closed_count: 1 }]);
  });
});

// Scenario RP-513-1 (RP-513; workflow-engine.md §3.3 rule 4, §3.4; V14), as the app role.
describe("scenario RP-513-1: K1 never reads C1's pool or holder", () => {
  const pool = (as: string, id: string) => call<{ names: unknown[] }>(as, sql`select names from app.work_item_pool(${id}::uuid)`);
  const holder = (as: string, id: string) =>
    call<{ assignee_member_id: string | null }>(as, sql`select assignee_member_id from app.work_item_holder(${id}::uuid)`);
  /** C1's pool and holder events of item `id` that `as` reads, by id. */
  const c1Events = (id: string) => (as: string) =>
    call<{ id: string }>(
      as,
      sql`select e.id from work_item_event e join participant p on p.id = e.actor_participant_id
          where e.work_item_id = ${id}::uuid and p.company_id = ${c1.id}::uuid and e.type in ('assigned', 'picked_up')`,
    );
  /** Item `id`'s pool, as the item's id when `as` reads it. */
  const poolOf = (id: string) => async (as: string) => (await pool(as, id)).map(() => ({ id }));
  /** The held Step assignments of item `id` that `as` reads. */
  const heldOf = (id: string) => (as: string) =>
    call<{ id: string }>(as, sql`select id from step_assignment where work_item_id = ${id}::uuid and assignee_member_id is not null`);

  it("C1's own Members read who its Comment waits on, then who holds it; K1 reads neither, by any function or table", async () => {
    const { comments } = await closedAtB("Pooled", [{ comment: "Who has it" }]);
    const comment = comments[0]!;
    expect((await pool(c1.member, comment))[0]?.names.length).toBeGreaterThan(1);
    await expectHiddenFrom({ read: poolOf(comment), target: comment, seenBy: c1.member, hiddenFrom: [k1.member, k1.ap], name: whoIs, label: "the pool" });
    for (const who of [k1.member, k1.ap]) expect(await holder(who, comment)).toEqual([{ assignee_member_id: null }]);
    expect(await pickUp(c1Pm, comment)).toBe("picked_up");
    expect(await holder(c1.member, comment)).toEqual([{ assignee_member_id: c1Pm }]);
    expect(await pool(c1.member, comment)).toEqual([]); // not hidden-from: a held Step has no pool, for anyone
    for (const who of [k1.member, k1.ap]) expect(await holder(who, comment)).toEqual([{ assignee_member_id: null }]);
    // C1 reads its PM's pick-up and the held assignment, by id; K1 reads neither.
    const pickedUp = await idOf("select id from work_item_event where work_item_id = $1 and type = 'picked_up'", [comment]);
    await expectHiddenFrom({ read: c1Events(comment), target: pickedUp, seenBy: [c1.member, c1Pm], hiddenFrom: [k1.member, k1.ap], name: whoIs, label: "C1's pick-up" });
    const held = await idOf("select id from step_assignment where work_item_id = $1 and assignee_member_id is not null", [comment]);
    await expectHiddenFrom({ read: heldOf(comment), target: held, seenBy: c1Pm, hiddenFrom: [k1.member, k1.ap], name: whoIs, label: "the held assignment" });
  });

  it("C1's only PM holds the internal review at once; K1 and OR never read that event once the item is Submitted", async () => {
    const { source } = await closedAtB("Held", [{ comment: "Held" }]);
    const own = await call<{ id: string; type: string; actor_member_id: string }>(
      c1Pm,
      sql`select id, type, actor_member_id from work_item_event where work_item_id = ${source}::uuid and type = 'assigned'`,
    );
    const assigned = own.find((e) => e.actor_member_id === c1Pm);
    expect(assigned, "C1's PM reads their own assignment").toMatchObject({ type: "assigned", actor_member_id: c1Pm });
    await expectHiddenFrom({ read: c1Events(source), target: assigned!.id, seenBy: c1Pm, hiddenFrom: [k1.member, k1.ap, or.member], name: whoIs, label: "C1's assignment" });
  });
});
