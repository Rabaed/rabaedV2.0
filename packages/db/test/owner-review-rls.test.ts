// Seam 2 for the Owner's review (ADR 0022, RP-593; workflow-engine.md §5.3a; visibility.md
// V5 and scenarios RP-593-1 to RP-593-3), as the app role. On a 1→1→1 Workflow the
// Consultant PM's Code is a Recommended Code to the Owner: it and the moves of the review
// are read by the Consultant and the Owner only. The Owner confirms it, which issues it and
// runs its result, or Sends the item Back; the Contractor reads the Code only once issued,
// never one sent back. An Owner Representative covering the item holds the review instead.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addOwnerReviewWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who.toLowerCase()}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "CNOWR";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
let c1: Company; // Contractor
let k1: Company; // Consultant
let ow: Company; // Owner
let or: Company; // Owner Representative: Electrical only
const people = { c1Engineer: "", c1Pm: "", k1Pm: "", owPm: "", orPm: "" };
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
  return { id, cr, ap };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

const take = (as: string, id: string, transition: string, answers: Record<string, unknown> = {}) =>
  outcome(
    as,
    sql`select app.take_transition(
      ${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, 'A note', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const takeable = async (as: string, id: string) =>
  (await call<{ key: string }>(as, sql`select transition_key as key from app.work_item_actions(${id}::uuid) where action = 'transition'`)).map((r) => r.key).sort();

/** Everything `as` reads of the item: its row (RLS), its events, their count, the history, the Activity Feed and its Comments. */
async function asRead(as: string, id: string) {
  return {
    item: (await call<{ outcome: string | null; closed: boolean }>(as, sql`select outcome, closed_at is not null as closed from work_item where id = ${id}::uuid`))[0],
    table: await call<{ type: string; payload: Record<string, unknown> }>(as, sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`),
    count: (await call<{ n: number }>(as, sql`select count(*)::integer as n from work_item_event where work_item_id = ${id}::uuid`))[0]!.n,
    history: await call<{ seq: number; type: string; recommended_code: string | null; outcome: string | null }>(
      as,
      sql`select seq, type, recommended_code, outcome from app.work_item_history(${id}::uuid)`,
    ),
    feed: (
      await call<{ type: string; work_item_id: string }>(as, sql`select type, work_item_id from app.activity_feed(${projectId}::uuid, null, '{}'::text[], false, null, 100)`)
    ).filter((e) => e.work_item_id === id),
    comments: (await call<{ open: number; closed: number }>(as, sql`select open_count as open, closed_count as closed from app.work_item_comment_counts(${id}::uuid)`))[0],
  };
}

/** Codes A to D anywhere in what `as` reads of the item, as a payload value or a Code. */
const codesRead = async (as: string, id: string) => {
  const read = await asRead(as, id);
  const found = new Set<string>();
  for (const e of read.table) for (const v of Object.values(e.payload)) if (typeof v === "string" && /^[A-D]$/.test(v)) found.add(v);
  for (const e of read.history) for (const v of [e.recommended_code, e.outcome]) if (v !== null) found.add(v);
  if (read.item?.outcome) found.add(read.item.outcome);
  return [...found].sort();
};

/** A Submitted item of `trade`, picked up by the Consultant PM. */
async function atConsultant(title: string, trade = mechanical): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    people.c1Engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${trade}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(people.c1Engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(people.c1Pm, id)).toBe("picked_up");
  expect(await take(people.c1Pm, id, "submit")).toBe("applied");
  return id;
}

const comments = { items_to_create: [{ comment: "Fix the gland plate" }, { comment: "Label the circuits" }] };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addOwnerReviewWorkflow((text) => migrator.query(text));
  const form = await one(`insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Owner review", "ar": "مراجعة المالك"}') returning id`, []);
  await migrator.query(
    "insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)",
    [
      form,
      JSON.stringify({
        sections: [{ key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] }],
      }),
    ],
  );
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, '{"en": "Owner review", "ar": "مراجعة المالك"}', $2, 'review_code', $3)`,
    [TYPE, workflowId, form],
  );
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  [c1, k1, ow, or] = [await company(engineer, "C1"), await company(engineer, "K1"), await company(engineer, "OW"), await company(engineer, "OR")];

  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWO', 'contractor')`);
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
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
  for (const [p, trades] of [
    [participant.c1, null],
    [participant.k1, null],
    [participant.ow, null],
    [participant.or, [electrical]],
  ] as const) {
    expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    expect(
      await outcome(
        c1.ap,
        sql`select app.set_participant_visibility(${p}::uuid, 'trade', ${trades === null}, ${trades ?? []}::uuid[], now()) as outcome`,
      ),
    ).toBe("set");
  }
  const staff: [Company, string, keyof typeof people, string[]][] = [
    [c1, participant.c1, "c1Engineer", ["engineer"]],
    [c1, participant.c1, "c1Pm", ["project_manager"]],
    [k1, participant.k1, "k1Pm", ["manager"]],
    [ow, participant.ow, "owPm", ["project_manager"]],
    [or, participant.or, "orPm", ["project_manager"]],
  ];
  for (const [co, p, who, positions] of staff) {
    people[who] = await member(co.id, who);
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${people[who]}::uuid, now())`);
    const trades = co === or ? [electrical] : null;
    expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${people[who]}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    expect(
      await outcome(
        co.ap,
        sql`select app.set_member_visibility(${p}::uuid, ${people[who]}::uuid, 'trade', ${trades === null}, ${trades ?? []}::uuid[], now()) as outcome`,
      ),
    ).toBe("set");
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${people[who]}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-593-1: K1's PM recommends Code B to the Owner, who confirms it", () => {
  it("C1 reads no Code until it is issued; the Owner reads B; confirming closes the item at B for everyone and raises its Comments", async () => {
    const id = await atConsultant("Cable trays");
    expect(await pickUp(people.k1Pm, id)).toBe("picked_up");
    const before = { c1: await asRead(people.c1Pm, id) };

    expect(await take(people.k1Pm, id, "recommend_b", comments)).toBe("applied");

    // C1 reads exactly what it read before: no event, count, history or feed entry, no Code.
    const c1During = await asRead(people.c1Pm, id);
    expect({ ...c1During, item: undefined }).toEqual({ ...before.c1, item: undefined });
    expect(c1During.item).toEqual({ outcome: null, closed: false });
    expect(await codesRead(people.c1Pm, id)).toEqual([]);
    expect(await codesRead(people.c1Engineer, id)).toEqual([]);
    // The Owner and K1 read the Recommended Code; it is stored internal to each of them.
    for (const by of [people.owPm, people.k1Pm]) {
      expect((await asRead(by, id)).history.filter((e) => e.type === "recommend_code").map((e) => e.recommended_code)).toEqual(["B"]);
    }
    const { rows } = await migrator.query(
      `select e.type, e.audience, p.company_id from work_item_event e
       join workflow_transition tr on tr.id = e.transition_id and tr.key = 'recommend_b'
       join participant p on p.id = e.audience_participant_id
       where e.work_item_id = $1 and e.type in ('recommend_code', 'transition')
       order by e.seq`,
      [id],
    );
    expect(rows.map((r) => [r.type, r.audience, r.company_id]).sort()).toEqual(
      [
        ["recommend_code", "internal", k1.id],
        ["recommend_code", "internal", ow.id],
        ["transition", "internal", k1.id],
        ["transition", "internal", ow.id],
      ].sort(),
    );

    // The Owner holds it and is offered only the Confirm of B (and its Send Back).
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await takeable(people.owPm, id)).toEqual(["confirm_b", "owner_send_back"]);
    // Its one "Confirm" button issues the Recommended Code, whichever of its closes is named.
    expect(await take(people.owPm, id, "confirm_a")).toBe("applied");
    for (const by of [people.c1Pm, people.k1Pm, people.owPm]) {
      expect((await asRead(by, id)).item).toEqual({ outcome: "B", closed: true });
    }
    const c1After = await asRead(people.c1Pm, id);
    expect(c1After.history.at(-1)).toMatchObject({ type: "issue_code", outcome: "B" });
    expect(c1After.history.map((e) => e.type)).not.toContain("recommend_code");
    expect(c1After.history.map((e) => e.seq)).toEqual(c1After.history.map((_, i) => i + 1));
    // Its Comments, one per row of K1's Recommendation, raised by K1 and held by C1.
    expect(c1After.comments).toEqual({ open: 2, closed: 0 });
    const { rows: raised } = await migrator.query(
      `select p.company_id, c.title from work_item_link l join work_item c on c.id = l.from_id join participant p on p.id = c.raised_by_participant_id
       where l.to_id = $1 and l.kind = 'raised_from' order by c.title`,
      [id],
    );
    expect(raised).toEqual([
      { company_id: k1.id, title: "Fix the gland plate" },
      { company_id: k1.id, title: "Label the circuits" },
    ]);
  });
});

describe("scenario RP-593-2: the Owner Sends B Back, K1 recommends C, the Owner confirms it", () => {
  it("issues Code C, offers a Revision, and C1 never reads B", async () => {
    const id = await atConsultant("Switchgear");
    expect(await pickUp(people.k1Pm, id)).toBe("picked_up");
    expect(await take(people.k1Pm, id, "recommend_b", comments)).toBe("applied");
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await take(people.owPm, id, "owner_send_back")).toBe("applied");
    // Back with K1's PM, who held it, and nothing cleared: it may recommend again.
    expect(await takeable(people.k1Pm, id)).toEqual(["recommend_a", "recommend_b", "recommend_c", "recommend_d"]);
    expect(await codesRead(people.c1Pm, id)).toEqual([]);

    expect(await take(people.k1Pm, id, "recommend_c")).toBe("applied");
    expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await takeable(people.owPm, id)).toEqual(["confirm_c", "owner_send_back"]);
    expect(await take(people.owPm, id, "confirm_c")).toBe("applied");

    expect(await codesRead(people.c1Pm, id)).toEqual(["C"]);
    expect(await codesRead(people.c1Engineer, id)).toEqual(["C"]);
    expect((await asRead(people.owPm, id)).history.filter((e) => e.type === "recommend_code").map((e) => e.recommended_code)).toEqual(["B", "C"]);
    expect(await outcome(people.c1Engineer, sql`select app.can_create_revision(${id}::uuid)::text as outcome`)).toBe("true");
    // No Comments: C raises none, and B's were never issued.
    expect((await asRead(people.c1Pm, id)).comments).toEqual({ open: 0, closed: 0 });
  });
});

describe("scenario RP-593-3: on an item an Owner Representative covers, it holds the Owner's review", () => {
  it("OR's PM confirms the Code; the Owner reads no Recommended Code", async () => {
    const id = await atConsultant("Lighting", electrical);
    expect(await pickUp(people.k1Pm, id)).toBe("picked_up");
    expect(await take(people.k1Pm, id, "recommend_a")).toBe("applied");

    expect(await pickUp(people.owPm, id)).not.toBe("picked_up");
    expect(await pickUp(people.orPm, id)).toBe("picked_up");
    expect((await asRead(people.orPm, id)).history.filter((e) => e.type === "recommend_code").map((e) => e.recommended_code)).toEqual(["A"]);
    expect(await codesRead(people.owPm, id)).toEqual([]);
    expect(await codesRead(people.c1Pm, id)).toEqual([]);

    expect(await take(people.orPm, id, "confirm_a")).toBe("applied");
    for (const by of [people.c1Pm, people.owPm, people.k1Pm]) expect((await asRead(by, id)).item).toEqual({ outcome: "A", closed: true });
  });
});
