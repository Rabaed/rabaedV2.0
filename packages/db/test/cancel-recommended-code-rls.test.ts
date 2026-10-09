// Seam 2 for Cancel and the Recommended Code (RP-433, WF-10; spec RP-423;
// workflow-engine.md §5.1, §5.3; visibility.md V5 and scenario RP-433-1), as the app
// role. A Cancel is taken from the raiser's own Steps only until the item is first
// Submitted, and issues no Document Number from Draft. A Recommended Code is its own
// event internal to the recommender's Participant: another Participant never reads
// it, in the events table, the history, the Activity Feed or their counts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addSendBackWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "CNRCD";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: its engineer raises the items.
let k1: Company; // Consultant: its engineer recommends a Code.
let c1Pm = "";
let k1Manager = "";
let projectId = "";
let electrical = "";
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

const take = (as: string, id: string, transition: string, recommendedCode: string | null = null) =>
  outcome(
    as,
    sql`select app.take_transition(
      ${id}::uuid, ${transition}, '{}'::jsonb, 'A note', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(),
      null::uuid, ${recommendedCode}::text) as outcome`,
  );
const claim = (as: string, id: string) => outcome(as, sql`select app.claim_step(${id}::uuid, now()) as outcome`);
const takeable = async (as: string, id: string) =>
  (await call<{ key: string }>(as, sql`select transition_key as key from app.work_item_actions(${id}::uuid) where action = 'transition'`))
    .map((r) => r.key)
    .sort();
const recommendable = async (as: string, id: string, transition: string) =>
  (await call<{ code: string }>(as, sql`select code from app.transition_recommendable_outcomes(${id}::uuid, ${transition})`)).map((r) => r.code);

/** Everything `as` reads of the item's events: the table (RLS), its count, the history and the Activity Feed. */
async function eventsAsRead(as: string, id: string) {
  return {
    table: await call<{ type: string; payload: Record<string, unknown> }>(
      as,
      sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`,
    ),
    count: (await call<{ n: number }>(as, sql`select count(*)::integer as n from work_item_event where work_item_id = ${id}::uuid`))[0]!.n,
    history: await call<{ seq: number; type: string; recommended_code: string | null; internal_note: string | null }>(
      as,
      sql`select seq, type, recommended_code, internal_note from app.work_item_history(${id}::uuid)`,
    ),
    feed: (
      await call<{ type: string; work_item_id: string }>(
        as,
        sql`select type, work_item_id from app.activity_feed(${projectId}::uuid, null, '{}'::text[], false, null, 100)`,
      )
    ).filter((e) => e.work_item_id === id),
  };
}

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

async function inReview(model: string): Promise<string> {
  const id = await draft(model);
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await claim(c1Pm, id)).toBe("claimed");
  return id;
}

/** Submitted to K1, claimed by K1's engineer at the Step that Recommends a Code. */
async function atConsultantReview(model: string): Promise<string> {
  const id = await inReview(model);
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  expect(await claim(k1.member, id)).toBe("claimed");
  return id;
}

const recorded = async (id: string) =>
  (await migrator.query("select outcome, document_number, closed_at is not null as closed from work_item where id = $1", [id])).rows[0] as {
    outcome: string | null;
    document_number: string | null;
    closed: boolean;
  };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addSendBackWorkflow((text) => migrator.query(text), { withCancel: true, recommendCode: true });
  const form = await one(`insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Cancel", "ar": "إلغاء"}') returning id`, []);
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
     values ('rabaed', 'submittals', $1, '{"en": "Cancel", "ar": "إلغاء"}', $2, 'review_code', $3)`,
    [TYPE, workflowId, form],
  );
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWR', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
  ];
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe(
        "set",
      );
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Cancel", () => {
  it("from Draft closes the item cancelled with no Document Number; from Internal Review, keeping its number", async () => {
    const fromDraft = await draft("Cancelled Draft");
    expect(await takeable(c1.member, fromDraft)).toContain("cancel");
    expect(await take(c1.member, fromDraft, "cancel")).toBe("applied");
    expect(await recorded(fromDraft)).toEqual({ outcome: "cancelled", document_number: null, closed: true });

    const fromReview = await inReview("Cancelled in review");
    const { document_number: number } = await recorded(fromReview);
    expect(number).not.toBeNull();
    expect(await take(c1Pm, fromReview, "cancel_review")).toBe("applied");
    expect(await recorded(fromReview)).toEqual({ outcome: "cancelled", document_number: number, closed: true });
  });

  it("is neither offered nor taken once the item has been Submitted, even back at the raiser's Steps", async () => {
    const id = await atConsultantReview("Sent back");
    expect(await take(k1.member, id, "send_back")).toBe("applied");
    expect(await claim(c1Pm, id)).toBe("claimed");
    expect(await takeable(c1Pm, id)).not.toContain("cancel_review");
    expect(await take(c1Pm, id, "cancel_review")).toBe("transition_not_available");
    expect((await recorded(id)).closed).toBe(false);
  });
});

describe("scenario RP-433-1: K1's engineer recommends Code A to their manager", () => {
  it("C1 reads nothing of it: not in the events, their count, the history or the Activity Feed; K1 reads it", async () => {
    const id = await atConsultantReview("Recommended");
    const before = { engineer: await eventsAsRead(c1.member, id), pm: await eventsAsRead(c1Pm, id) };
    expect(await recommendable(k1.member, id, "send_to_manager")).toEqual(["A", "B", "C", "D"]);

    expect(await take(k1.member, id, "send_to_manager", "A")).toBe("applied");

    expect(await eventsAsRead(c1.member, id)).toEqual(before.engineer);
    expect(await eventsAsRead(c1Pm, id)).toEqual(before.pm);
    const k1Reads = await eventsAsRead(k1Manager, id);
    expect(k1Reads.table.filter((e) => e.type === "recommend_code").map((e) => e.payload)).toEqual([{ recommended_code: "A" }]);
    expect(k1Reads.history.filter((e) => e.type === "recommend_code").map((e) => e.recommended_code)).toEqual(["A"]);
    expect(k1Reads.feed.map((e) => e.type)).toContain("recommend_code");
    // Stored internal to K1: the migrator reads the row.
    const { rows } = await migrator.query(
      `select e.audience, p.company_id from work_item_event e join participant p on p.id = e.audience_participant_id
       where e.work_item_id = $1 and e.type = 'recommend_code'`,
      [id],
    );
    expect(rows).toEqual([{ audience: "internal", company_id: k1.id }]);

    // Once the Code is issued, C1 reads the Code and counts on with no gap.
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await take(k1Manager, id, "approve_a")).toBe("applied");
    const after = await eventsAsRead(c1Pm, id);
    expect(after.count).toBe(before.pm.count + 1);
    expect(after.history.map((e) => e.seq)).toEqual(after.history.map((_, i) => i + 1));
    expect(after.history.map((e) => e.recommended_code)).toEqual(after.history.map(() => null));
  });

  it("is refused alike where the Transition doesn't offer it, with nothing written", async () => {
    const id = await atConsultantReview("Refused");
    const count = async () => (await migrator.query("select count(*)::integer as n from work_item_event where work_item_id = $1", [id])).rows[0].n;
    const n = await count();
    for (const [transition, code] of [
      ["send_to_manager", "Z"],
      ["send_to_manager", "cancelled"],
      ["send_back", "A"],
    ] as const) {
      expect(await take(k1.member, id, transition, code)).toBe("recommended_code_not_offered");
    }
    expect(await recommendable(k1.member, id, "send_back")).toEqual([]);
    // Another Member, not holding it, is offered nothing.
    expect(await recommendable(k1Manager, id, "send_to_manager")).toEqual([]);
    expect(await recommendable(c1Pm, id, "send_to_manager")).toEqual([]);
    expect(await count()).toBe(n);

    const other = await inReview("Not a recommending Step");
    expect(await take(c1Pm, other, "submit", "A")).toBe("recommended_code_not_offered");
  });
});
