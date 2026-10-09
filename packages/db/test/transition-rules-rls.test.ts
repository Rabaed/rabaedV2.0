// Seam 2 for Transition rules at run time (RP-430, WF-7; workflow-engine.md §4,
// §5.1; visibility.md "Refusals of a Transition", scenarios RP-430-1, RP-430-2 and
// RP-430-3), as the app role. The condition language in SQL (app.condition_holds)
// gives what @rabaed/domain's evaluateCondition gives, over the same cases. "Not
// the same person" and "has been through" read only what the acting Participant
// may read, and "all Comments closed" only the Comments the acting Member sees: a
// Transition is offered, or refused, alike whatever is hidden from them.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addRulesWorkflow, joinProject, rulesFormSchema, testDatabaseUrls } from "../test-support/index.ts";

type Case = { name: string; rule: unknown; fields: object; actionForm?: object; attrs?: object; holds: boolean };
const cases = JSON.parse(readFileSync(new URL("../../domain/src/condition-cases.json", import.meta.url), "utf8")) as Case[];

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "RULES";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: its engineer raises the items.
let k1: Company; // Consultant: its engineer reviews.
let c1Pm = "";
let c1Pm2 = "";
let k1Manager = "";
let k1Manager2 = "";
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

/**
 * The rules Workflow, with one Transition publishing refuses: a Consultant
 * Transition that asks whether the item has been through the Contractor's own
 * review, which the run time must never answer from what C1 did (V5, V14).
 */
async function addType() {
  const workflowId = await addRulesWorkflow((text) => migrator.query(text), {
    extra: [
      {
        key: "check_contractor_route",
        from: "consultant_review",
        to: "consultant_approval",
        label: { en: "Check the Contractor's route", ar: "تحقق من مسار المقاول" },
        kind: "send",
        outcome: null,
        permission: "review",
        rules: { restrict: [{ type: "been_through", step: "internal_review" }] },
      },
      // One label, routed by the pop-up's answer, with a gap: any other answer has no route.
      ...(["fast", "slow"] as const).map((route) => ({
        key: `route_${route}`,
        from: "internal_review",
        to: "consultant_review",
        label: { en: "Submit by route", ar: "تقديم حسب المسار" },
        kind: "submit",
        outcome: null,
        permission: "submit",
        action_form: {
          sections: [{ key: "routing", title: { en: "Route", ar: "المسار" }, fields: [{ key: "route", type: "text", label: { en: "Route", ar: "المسار" } }] }],
        },
        rules: { restrict: [{ type: "condition", condition: { field: "route", op: "=", value: route } }] },
      })),
    ],
  });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Rules", "ar": "القواعد"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(rulesFormSchema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Rules", "ar": "القواعد"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const claim = (as: string, id: string) => outcome(as, sql`select app.claim_step(${id}::uuid, now()) as outcome`);
const offered = async (as: string, id: string) =>
  (await call<{ transition_key: string }>(as, sql`select transition_key from app.work_item_actions(${id}::uuid) where action = 'transition'`)).map(
    (r) => r.transition_key,
  );

async function draft(by: string, model: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    by,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** A C1 item at K1's Consultant review, Submitted by the C1 PM. */
async function submitted(model: string): Promise<string> {
  const id = await draft(c1.member, model);
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await claim(c1Pm, id)).toBe("claimed");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c1Pm = await member(c1.id, "pm");
  c1Pm2 = await member(c1.id, "pm2");
  k1Manager = await member(k1.id, "manager");
  k1Manager2 = await member(k1.id, "manager2");

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
    [c1, participant.c1, c1Pm2, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
    [k1, participant.k1, k1Manager2, ["manager"]],
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

describe("app.condition_holds, the cases shared with @rabaed/domain", () => {
  it.each(cases)("$name", async ({ rule, fields, actionForm, attrs, holds }) => {
    const { rows } = await migrator.query<{ holds: boolean }>("select app.condition_holds($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb) as holds", [
      JSON.stringify(rule),
      JSON.stringify(fields),
      actionForm === undefined ? null : JSON.stringify(actionForm),
      JSON.stringify(attrs ?? {}),
    ]);
    expect(rows[0]!.holds).toBe(holds);
  });
});

describe("a label shared by several Transitions", () => {
  it("is offered once, and the Action Form answer picks its route; none or several is no route", async () => {
    const id = await draft(c1.member, "Routed");
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, id)).toBe("claimed");
    expect((await offered(c1Pm, id)).filter((key) => key.startsWith("route_"))).toEqual(["route_fast"]);
    expect(await take(c1Pm, id, "route_fast", { route: "sideways" })).toBe("no_route");
    expect(await take(c1Pm, id, "route_fast", {})).toBe("no_route");
    // Asked by either key, the answer decides.
    expect(await take(c1Pm, id, "route_fast", { route: "slow" })).toBe("applied");
    const [moved] = await migrator.query(
      "select tr.key from work_item_event e join workflow_transition tr on tr.id = e.transition_id where e.work_item_id = $1 order by e.seq desc limit 1",
      [id],
    ).then((r) => r.rows as { key: string }[]);
    expect(moved!.key).toBe("route_slow");
  });
});

describe("not the same person (RP-430-1)", () => {
  it("hides Approve from the K1 manager who sent the item to the Manager, and offers it to another", async () => {
    const id = await submitted("Separation");
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await take(k1Manager, id, "send_to_manager")).toBe("applied");
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await offered(k1Manager, id)).not.toContain("approve_a");
    expect(await take(k1Manager, id, "approve_a")).toBe("transition_not_available");
    // Released, the Step goes to the other manager, who may approve it.
    expect(await outcome(k1Manager, sql`select app.release_step(${id}::uuid, now()) as outcome`)).toBe("released");
    expect(await claim(k1Manager2, id)).toBe("claimed");
    expect(await offered(k1Manager2, id)).toContain("approve_a");
    expect(await take(k1Manager2, id, "approve_a")).toBe("applied");
  });

  it("reads the acting Member's own moves only: the C1 PM who raised and sent it can't submit it a second time", async () => {
    const id = await draft(c1Pm, "Second pair of eyes");
    expect(await take(c1Pm, id, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, id)).toBe("claimed");
    expect(await offered(c1Pm, id)).not.toContain("submit_separate");
    expect(await outcome(c1Pm, sql`select app.release_step(${id}::uuid, now()) as outcome`)).toBe("released");
    expect(await claim(c1Pm2, id)).toBe("claimed");
    expect(await offered(c1Pm2, id)).toContain("submit_separate");
  });
});

describe("not the same person keeps that Member from holding the next Step (RP-430-1)", () => {
  const release = (as: string, id: string) => outcome(as, sql`select app.release_step(${id}::uuid, now()) as outcome`);
  const assignees = async (as: string, id: string, transition: string) =>
    (await call<{ member_id: string }>(as, sql`select member_id from app.transition_assignees(${id}::uuid, ${transition})`)).map((r) => r.member_id);
  const holding = async (id: string) =>
    (
      await migrator.query<{ status: string; assignee_member_id: string | null }>(
        "select status, assignee_member_id from step_assignment where work_item_id = $1 and status in ('pooled', 'claimed', 'vacant')",
        [id],
      )
    ).rows[0];

  /** At K1's review again, held by its engineer: K1's manager sent it to the Manager, `returner` returned it. */
  async function backAtReview(model: string, returner: string): Promise<string> {
    const id = await submitted(model);
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await take(k1Manager, id, "send_to_manager")).toBe("applied");
    expect(await claim(returner, id)).toBe("claimed");
    expect(await take(returner, id, "return_to_engineer")).toBe("applied");
    // Back to the manager who held the review; handed on to K1's engineer.
    expect(await release(k1Manager, id)).toBe("released");
    expect(await claim(k1.member, id)).toBe("claimed");
    return id;
  }

  it("leaves the Member out of the next Step's pool, of Assign to and of coming back", async () => {
    const id = await backAtReview("Fresh eyes", k1Manager);
    expect(await offered(k1.member, id)).toContain("fresh_eyes");
    expect(await assignees(k1.member, id, "fresh_eyes")).toEqual([k1Manager2]);
    expect(
      await outcome(
        k1.member,
        sql`select app.take_transition(${id}::uuid, 'fresh_eyes', '{}'::jsonb, '', app.answers_sha256(${id}::uuid),
          ${randomUUID()}::uuid, now(), ${k1Manager}::uuid) as outcome`,
      ),
    ).toBe("assignee_not_offered");
    expect(await take(k1.member, id, "fresh_eyes")).toBe("applied");
    // The manager who sent it to the Manager can't claim it; the other can.
    expect(await claim(k1Manager, id)).toBe("forbidden");
    expect(await call(k1Manager, sql<{ action: string }>`select action from app.work_item_actions(${id}::uuid) where action = 'claim'`)).toEqual([]);
    expect(await claim(k1Manager2, id)).toBe("claimed");

    // Returned to the review, which K1's engineer left last: not back to them, nor to the
    // manager who left it before, but to its pool without either.
    expect(await take(k1Manager2, id, "return_fresh")).toBe("applied");
    expect(await holding(id)).toEqual({ status: "pooled", assignee_member_id: null });
    expect(await claim(k1.member, id)).toBe("forbidden");
    expect(await claim(k1Manager, id)).toBe("forbidden");
    expect(await claim(k1Manager2, id)).toBe("claimed");
  });

  it("is refused with the usual answer when nobody is left to hold the next Step", async () => {
    const id = await backAtReview("No fresh eyes", k1Manager2);
    expect(await offered(k1.member, id)).not.toContain("fresh_eyes");
    expect(await take(k1.member, id, "fresh_eyes")).toBe("next_step_unavailable");
  });
});

describe("has been through a Step (RP-430-2)", () => {
  it("never holds for K1 on the Contractor's Step, though C1's Submit left it", async () => {
    const id = await submitted("Contractor route");
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await offered(k1Manager, id)).not.toContain("check_contractor_route");
    expect(await take(k1Manager, id, "check_contractor_route")).toBe("transition_not_available");
  });

  it("holds for C1 on its own Step once the item has been there", async () => {
    const id = await draft(c1Pm, "Own route");
    expect(await offered(c1Pm, id)).not.toContain("submit_direct");
    expect(await take(c1Pm, id, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm2, id)).toBe("claimed");
    expect(await take(c1Pm2, id, "return")).toBe("applied");
    expect(await offered(c1Pm, id)).toContain("submit_direct");
  });
});

describe("all Comments closed (RP-430-3)", () => {
  it("reads only the Comments the K1 manager sees, and names none", async () => {
    const id = await submitted("Commented");
    // A Comment raised from it that K1 can't see: C1's Draft.
    const comment = await draft(c1.member, "Comment 1");
    await migrator.query(
      "insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id) values ($1, $2, $3, 'raised_from', $4)",
      [projectId, comment, id, c1.member],
    );
    expect(await claim(k1Manager, id)).toBe("claimed");
    expect(await take(k1Manager, id, "send_to_manager")).toBe("applied");
    expect(await claim(k1Manager2, id)).toBe("claimed");
    expect(await offered(k1Manager2, id)).toContain("reject_d");

    // Submitted, K1 sees the open Comment: Reject is no longer offered, and refused like one that isn't there.
    expect(await take(c1.member, comment, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, comment)).toBe("claimed");
    expect(await take(c1Pm, comment, "submit")).toBe("applied");
    expect(await offered(k1Manager2, id)).not.toContain("reject_d");
    expect(await take(k1Manager2, id, "reject_d")).toBe("transition_not_available");
    expect(await take(k1Manager2, id, "made_up")).toBe("transition_not_available");
  });
});
