// Seam 2 for Transition actions at run time (RP-431, WF-8; spec RP-423;
// workflow-engine.md §3.3, §5.1; visibility.md "Refusals of a Transition",
// scenarios RP-431-1 and RP-431-2), as the app role. "Assign to" offers only
// Members of the actor's own Participant who may hold the next Step, and a pick it
// couldn't have offered is refused alike, whoever it names. Set and copy write
// only fields the acting Participant fills at that Step, inside take_transition's
// transaction, recorded like any answer change; an action that would write into
// another Participant's answers, read them, or carry an internal Action Form
// answer into the Form is refused alike, with nothing written.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { actionsFormSchema, addActionsWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "ACTS";

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

const label = (en: string) => ({ en, ar: en });

/**
 * The actions Workflow, with Transitions publishing refuses: C1 setting the
 * Consultant's Verdict at its Submit; K1 copying C1's Model into its Verdict,
 * setting C1's Model, and copying its internal Action Form note into the Form.
 */
async function addType() {
  const workflowId = await addActionsWorkflow((text) => migrator.query(text), {
    extra: [
      {
        key: "submit_with_verdict",
        from: "internal_review",
        to: "consultant_review",
        label: label("Submit with a verdict"),
        kind: "submit",
        outcome: null,
        permission: "submit",
        actions: [{ type: "set_field", field: "verdict", value: "Approved" }],
      },
      {
        key: "send_copying_model",
        from: "consultant_review",
        to: "consultant_approval",
        label: label("Send with the model"),
        kind: "send",
        outcome: null,
        permission: "review",
        actions: [{ type: "copy_field", from: "model", to: "verdict" }],
      },
      {
        key: "send_setting_model",
        from: "consultant_review",
        to: "consultant_approval",
        label: label("Send, renaming the model"),
        kind: "send",
        outcome: null,
        permission: "review",
        actions: [{ type: "set_field", field: "model", value: "Changed by K1" }],
      },
      {
        key: "send_copying_note",
        from: "consultant_review",
        to: "consultant_approval",
        label: label("Send with a note"),
        kind: "send",
        outcome: null,
        permission: "review",
        action_form: {
          sections: [{ key: "to_manager", title: label("To the Manager"), fields: [{ key: "note", type: "textarea", label: label("Note") }] }],
        },
        actions: [{ type: "copy_field", from: "note", to: "verdict" }],
      },
    ],
  });
  const form = await one(`insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Actions", "ar": "الإجراءات"}') returning id`, []);
  await migrator.query(
    "insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)",
    [form, JSON.stringify(actionsFormSchema)],
  );
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, '{"en": "Actions", "ar": "الإجراءات"}', $2, 'review_code', $3)`,
    [TYPE, workflowId, form],
  );
}

const take = (as: string, id: string, transition: string, { answers = {}, assignTo = null }: { answers?: object; assignTo?: string | null } = {}) =>
  outcome(
    as,
    sql`select app.take_transition(
      ${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(),
      ${assignTo}::uuid) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const offeredAssignees = async (as: string, id: string, transition: string) =>
  (await call<{ member_id: string }>(as, sql`select member_id from app.transition_assignees(${id}::uuid, ${transition})`))
    .map((r) => r.member_id)
    .sort();
const needMyAction = async (as: string, id: string) =>
  (await call<{ need: string | null }>(as, sql`select app.need_my_action(${id}::uuid) as need`))[0]!.need;
const answers = async (as: string, id: string) =>
  (await call<{ answers: Record<string, unknown> }>(as, sql`select app.work_item_answers(${id}::uuid) as answers`))[0]!.answers;
const stepOf = async (id: string) =>
  (await migrator.query("select s.key from work_item w join workflow_step s on s.id = w.current_step_id where w.id = $1", [id])).rows[0]
    .key as string;
/** The item's events as `as` reads them (RLS: shared, or internal to their Participant). */
const events = async (as: string, id: string) =>
  call<{ type: string; payload: Record<string, unknown> }>(as, sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`);

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

/** A C1 item at the C1 PM's review, picked up by them. */
async function inReview(model: string): Promise<string> {
  const id = await draft(c1.member, model);
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  return id;
}

/** A C1 item at K1's Consultant review, Submitted by the C1 PM, picked up by the K1 engineer. */
async function submitted(model: string): Promise<string> {
  const id = await inReview(model);
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  return id;
}

/** Today's date in Riyadh, as a `date` field stores it. */
const riyadhToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

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

describe('"Assign to" (RP-431-2)', () => {
  it("offers the Members of the actor's own Participant who may hold the next Step, and lands the item with the one picked", async () => {
    const id = await draft(c1.member, "Assigned");
    // The C1 PMs hold Contractor review; the C1 engineer can't, and K1 is another Company.
    expect(await offeredAssignees(c1.member, id, "send_for_review")).toEqual([c1Pm, c1Pm2].sort());
    expect(await take(c1.member, id, "send_for_review", { assignTo: c1Pm2 })).toBe("applied");
    expect(await stepOf(id)).toBe("internal_review");
    expect(await needMyAction(c1Pm2, id)).toBe("waiting");
    expect(await needMyAction(c1Pm, id)).toBeNull();
    // Picked up for them: they take Submit without picking it up.
    expect(await take(c1Pm2, id, "submit")).toBe("applied");
  });

  it("refuses a pick it couldn't have offered alike, whoever it names, and writes nothing", async () => {
    const id = await draft(c1.member, "Wrong picks");
    const refused = ["assignee_not_offered"];
    // Another Company's Member, a C1 Member who can't hold the Step, a made-up id.
    for (const pick of [k1Manager, k1.member, c1.member, randomUUID()]) {
      expect([await take(c1.member, id, "send_for_review", { assignTo: pick })]).toEqual(refused);
    }
    expect(await stepOf(id)).toBe("draft");
    expect(await answers(c1.member, id)).not.toHaveProperty("reference");
  });

  it("offers nobody when the next Step is another Participant's, and refuses any pick for it", async () => {
    const id = await inReview("Submit to K1");
    expect(await offeredAssignees(c1Pm, id, "submit")).toEqual([]);
    expect(await take(c1Pm, id, "submit", { assignTo: k1.member })).toBe("assignee_not_offered");
    expect(await take(c1Pm, id, "submit", { assignTo: c1Pm2 })).toBe("assignee_not_offered");
    // Unpicked, it goes to K1's Step Pool as ever.
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await needMyAction(k1.member, id)).toBe("waiting");
  });

  it("offers nobody on a Transition without Assign to, nor to a Member who doesn't hold the item", async () => {
    const id = await submitted("No offer");
    expect(await take(k1.member, id, "send_to_manager", { assignTo: k1Manager })).toBe("applied");
    expect(await needMyAction(k1Manager, id)).toBe("waiting");
    expect(await needMyAction(k1Manager2, id)).toBeNull();
    // The other manager doesn't hold it: offered nothing.
    expect(await offeredAssignees(k1Manager2, id, "return_to_engineer")).toEqual([]);
    expect(await offeredAssignees(k1Manager, id, "approve_a")).toEqual([]);
    expect(await take(k1Manager, id, "approve_a", { assignTo: k1Manager2 })).toBe("assignee_not_offered");
    // C1 sees the item now, but holds nothing of it.
    expect(await offeredAssignees(c1Pm, id, "return_to_engineer")).toEqual([]);
  });
});

describe("set and copy", () => {
  it("sets a date to the moment taken and copies one of the raiser's fields to another, at its own Step", async () => {
    const id = await draft(c1.member, "Model X");
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await answers(c1Pm, id)).toMatchObject({ model: "Model X", reference: "Model X", sent_on: riyadhToday() });
  });

  it("writes K1's own Review at its Step, recorded inside K1 and read by C1 as it arrived until the Code (RP-431-1)", async () => {
    const id = await submitted("Reviewed");
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await answers(k1Manager, id)).toMatchObject({ verdict: "Checked", reviewed_on: riyadhToday() });
    // C1 reads the Review as it arrived: empty, and no change on its record.
    const c1Reads = await answers(c1Pm, id);
    expect(c1Reads).not.toHaveProperty("verdict");
    expect(c1Reads).not.toHaveProperty("reviewed_on");
    expect((await events(c1Pm, id)).map((e) => e.type)).not.toContain("answers_changed");
    const k1Changes = (await events(k1Manager, id)).filter((e) => e.type === "answers_changed");
    expect(k1Changes.flatMap((e) => (e.payload.changes as { field: string }[]).map((c) => c.field)).sort()).toEqual(["reviewed_on", "verdict"]);

    // The Code: the Remarks copied into the Reviewer's note, and everyone reads the Review.
    expect(await pickUp(k1Manager, id)).toBe("picked_up");
    expect(await take(k1Manager, id, "approve_a", { answers: { remarks: "Fine as built." } })).toBe("applied");
    expect(await answers(c1Pm, id)).toMatchObject({ verdict: "Checked", reviewer_note: "Fine as built." });
  });
});

describe("an action outside what the acting Participant fills (RP-431-1)", () => {
  it("refuses C1 setting K1's Verdict, alike and with nothing written", async () => {
    const id = await inReview("C1 into K1");
    expect(await take(c1Pm, id, "submit_with_verdict")).toBe("action_not_allowed");
    expect(await stepOf(id)).toBe("internal_review");
  });

  it("refuses K1 reading or writing C1's answers, or carrying its internal note into the Form, alike", async () => {
    const id = await submitted("K1 into C1");
    for (const [transition, answered] of [
      ["send_copying_model", {}],
      ["send_setting_model", {}],
      ["send_copying_note", { note: "Our Recommended Code: A" }],
    ] as const) {
      expect(await take(k1.member, id, transition, { answers: answered })).toBe("action_not_allowed");
    }
    expect(await stepOf(id)).toBe("consultant_review");
    expect(await answers(k1.member, id)).toMatchObject({ model: "K1 into C1" });
    expect(await answers(k1.member, id)).not.toHaveProperty("verdict");
    expect((await events(k1.member, id)).map((e) => e.type)).not.toContain("answers_changed");
  });
});
