// Seam 2 for withdrawing a Participant (RP-952, ADR 0028; visibility.md "A Participant's withdrawal";
// workflow-engine.md §9; scenarios RP-952-1 to RP-952-5), as the app role. Only the Host Company's
// Project Admin previews (counts only) and withdraws, never the Host Company itself. In one
// transaction the Participant's items that left Draft are Cancelled by Rabaed with a Record, its
// Drafts and Draft Revisions with none, and its Steps on other Companies' items become
// Participant-level Vacancies that name only its Project Role. Its Authorized Person and Project
// Members are told; nobody else is. Its Members lose the Project. PR 2 (RP-952-6, RP-952-7): the
// Vacancies list names each Vacancy's Step, and only the Host Company's Project Admins read the
// withdrawn Participants.
//
// The describes run in order on one Project: the refusals, then C2's withdrawal, then K1's.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "WDPR";
/** The same, on a Workflow with no Cancelled Step (as Comment, the Questions, Site Observation and Snag are). */
const NO_CANCEL_TYPE = "WDPN";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // The Host Company: its Authorized Person created the Project and is its Project Admin.
let k1: Company; // The Consultant: holds C1's and C2's items at review.
let c2: Company; // A second Contractor, withdrawn first.
let other: Company; // The Project Admin of another Project.
let c1Pm = "";
let c1Admin = ""; // A second Project Admin of C1, on the Project with full Visibility: the Vacancies list names the item to them.
let c2Pm = "";
let k1Manager = "";
let projectId = "";
let electrical = "";
let buildingA = "";
const participant = { c1: "", k1: "", c2: "" };
let vacantItem = ""; // C1's item K1 held when it was withdrawn (RP-952-3, read again by RP-952-5).

const names = new Map<string, string>();
const nameOf = (as: string) => names.get(as) ?? "a Member";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
    creator,
  ]);
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** Adds Rabaed Type `code` on a new test Workflow: with a Cancel to a Cancelled Step, or (`withCancel` false) with none. */
async function addType(code: string, withCancel: boolean) {
  const schema = {
    sections: [
      { key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] },
      {
        key: "classification",
        title: { en: "Classification", ar: "التصنيف" },
        fields: [
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        ],
      },
    ],
  };
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withCancel });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${code}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Withdraw a Participant", "ar": "سحب مشارك"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${code}', '{"en": "Withdraw a Participant", "ar": "سحب مشارك"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

async function draft(as: string, model: string, type = TYPE): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${model}, app.latest_form_version(${type}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** `engineer` sends the Draft for review and `pm` Submits it: it waits for K1's engineer, who picks it up. */
async function atK1(engineer: string, pm: string, model: string, type = TYPE): Promise<string> {
  const id = await draft(engineer, model, type);
  expect(await take(engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, id, "submit")).toBe("applied");
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  return id;
}

// The reads, each as the app role.
const preview = (as: string, id: string) =>
  call<{ outcome: string; items_to_cancel: number | null; steps_to_vacate: number | null }>(
    as,
    sql`select * from app.participant_withdrawal_preview(${id}::uuid)`,
  ).then((rows) => rows[0]!);
const withdraw = (as: string, id: string) => outcome(as, sql`select app.withdraw_participant(${id}::uuid, now()) as outcome`);
const itemRows = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);
const vacancies = (as: string) =>
  call<{ id: string; work_item_id: string | null; document_number: string | null; title: string | null; base_role: string }>(
    as,
    sql`select step_assignment_id as id, work_item_id, document_number, title, base_role from app.project_vacancies(${projectId}::uuid)`,
  );
const withdrawalNotices = (as: string) =>
  call<{ id: string }>(as, sql`select id from notification where kind = 'participant_withdrawn' and project_id = ${projectId}::uuid`);
const participantStatus = async (id: string) => (await migrator.query("select status from participant where id = $1", [id])).rows[0].status as string;
const itemState = async (id: string) =>
  (await migrator.query("select outcome, closed_at, discarded_at from work_item where id = $1", [id])).rows[0] as {
    outcome: string | null;
    closed_at: Date | null;
    discarded_at: Date | null;
  };
const recordQueued = async (id: string) =>
  (await migrator.query("select 1 from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1", [id])).rowCount === 1;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType(TYPE, true);
  await addType(NO_CANCEL_TYPE, false);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  other = await company(engineer, "D1");
  c1Pm = await member(c1.id, "pm");
  c1Admin = await member(c1.id, "admin");
  c2Pm = await member(c2.id, "pm");
  k1Manager = await member(k1.id, "manager");
  for (const [as, name] of [
    [c1.ap, "C1's Project Admin"],
    [c1.member, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [c1Admin, "C1's second Project Admin"],
    [k1.ap, "K1's Authorized Person"],
    [k1.member, "the K1 engineer"],
    [k1Manager, "the K1 manager"],
    [c2.ap, "C2's Authorized Person"],
    [c2.member, "the C2 engineer"],
    [c2Pm, "the C2 PM"],
    [other.ap, "another Project's Project Admin"],
  ] as const)
    names.set(as, name);
  await call(other.ap, sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Elsewhere", "ar": "مكان آخر"}'::jsonb, 'WDO', 'contractor')`);
  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'WDP', 'contractor')`);
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  participant.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  participant.c2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const value = async (kind: string, valueCode: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, ${JSON.stringify({ en: valueCode, ar: valueCode })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [c1, participant.c1, c1Admin, ["engineer"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
    [c2, participant.c2, c2.member, ["engineer"]],
    [c2, participant.c2, c2Pm, ["project_manager"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
  // C1's second Project Admin, appointed by C1's Authorized Person.
  await migrator.query("insert into project_admin (project_id, member_id, appointed_by_member_id) values ($1, $2, $3)", [projectId, c1Admin, c1.ap]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-952-2: only the Host Company's Project Admin previews or withdraws, never the Host Company itself", () => {
  it("refuses everyone else alike, as for an id that does not exist, and the Host Company with host_company", async () => {
    const madeUp = randomUUID();
    for (const as of [c1.member, c1Pm, k1.ap, c2.ap, other.ap]) {
      expect((await preview(as, participant.c2)).outcome, `${nameOf(as)}'s preview`).toBe("not_found");
      expect(await withdraw(as, participant.c2), `${nameOf(as)}'s withdrawal`).toBe("not_found");
    }
    expect((await preview(c1.ap, madeUp)).outcome).toBe("not_found");
    expect(await withdraw(c1.ap, madeUp)).toBe("not_found");
    expect((await preview(c1.ap, participant.c1)).outcome).toBe("host_company");
    expect(await withdraw(c1.ap, participant.c1)).toBe("host_company");
    for (const p of Object.values(participant)) expect(await participantStatus(p)).toBe("active");
  });

  it("gives a refusal no counts", async () => {
    const refused = await preview(k1.ap, participant.c2);
    expect([refused.items_to_cancel, refused.steps_to_vacate]).toEqual([null, null]);
  });
});

describe("scenario RP-952-1: C1's Project Admin withdraws C2, which has an item with K1, a Draft and a Draft Revision", () => {
  let submitted = "";
  let c2Draft = "";
  let original = "";
  let revision = "";
  let noCancelStep = "";
  let noCancelStepAt = "";

  beforeAll(async () => {
    submitted = await atK1(c2.member, c2Pm, "WDPR-S");
    // One on a Workflow with no Cancelled Step.
    noCancelStep = await atK1(c2.member, c2Pm, "WDPR-N", NO_CANCEL_TYPE);
    noCancelStepAt = (await migrator.query("select current_step_id from work_item where id = $1", [noCancelStep])).rows[0].current_step_id as string;
    c2Draft = await draft(c2.member, "WDPR-D");
    // A C2 item K1 closed at Code C, and its Revision, still a Draft.
    original = await atK1(c2.member, c2Pm, "WDPR-R");
    expect(await take(k1.member, original, "send_to_manager")).toBe("applied");
    const held = await pickUp(k1Manager, original);
    expect(["picked_up", "already_picked_up"]).toContain(held);
    expect(await take(k1Manager, original, "revise_c")).toBe("applied");
    const [made] = await call<{ outcome: string; work_item_id: string }>(
      c2.member,
      sql`select outcome, work_item_id from app.create_revision(${original}::uuid, ${randomUUID()}::uuid, now())`,
    );
    expect(made!.outcome).toBe("created");
    revision = made!.work_item_id;
  });

  it("the preview gives the Project Admin counts only: the item that left Draft, never the Drafts", async () => {
    // Never the Drafts: no other Company ever saw them, so the Host Company doesn't learn how many there are.
    expect(await preview(c1.ap, participant.c2)).toEqual({ outcome: "ok", items_to_cancel: 2, steps_to_vacate: 0 });
  });

  it("C2's Draft and Draft Revision were never read by C1 or K1", async () => {
    for (const id of [c2Draft, revision]) {
      await expectHiddenFrom({ read: itemRows(id), target: id, seenBy: c2.member, hiddenFrom: [c1.ap, c1.member, k1.member, k1Manager], name: nameOf, label: "before the withdrawal" });
    }
  });

  it("cancels the item that left Draft by Rabaed, with a Record, its open Steps done at the close", async () => {
    expect(await withdraw(c1.ap, participant.c2)).toBe("withdrawn");
    expect(await participantStatus(participant.c2)).toBe("withdrawn");
    const state = await itemState(submitted);
    expect(state.outcome).toBe("cancelled");
    expect(state.closed_at).not.toBeNull();
    expect(state.discarded_at).toBeNull();
    expect(await recordQueued(submitted)).toBe(true);
    // One shared `cancelled` event with no Member, naming the Participant that left (RP-650 prints it).
    const { rows: events } = await migrator.query(
      "select actor_member_id, actor_participant_id, audience, payload from work_item_event where work_item_id = $1 and type = 'cancelled'",
      [submitted],
    );
    expect(events).toEqual([{ actor_member_id: null, actor_participant_id: null, audience: "shared", payload: { left_participant_id: participant.c2 } }]);
    // RP-955: the Steps open at the close are done at its `closed_at`, so app.held_at_close finds K1.
    const { rows: steps } = await migrator.query("select status, done_at from step_assignment where work_item_id = $1 and done_at >= $2", [submitted, state.closed_at]);
    expect(steps).toEqual([{ status: "done", done_at: state.closed_at }]);
  });

  it("K1, which held it, reads it closed and Cancelled, and reads Rabaed's event", async () => {
    await expectHiddenFrom({
      read: (as) => call<{ id: string }>(as, sql`select id from work_item where id = ${submitted}::uuid and outcome = 'cancelled' and closed_at is not null`),
      target: submitted,
      seenBy: [k1.member, k1Manager],
      hiddenFrom: [c1.member, c2.member],
      name: nameOf,
      label: "the Cancelled item",
    });
    const events = await call<{ id: string }>(k1.member, sql`select id from work_item_event where work_item_id = ${submitted}::uuid and type = 'cancelled' and actor_participant_id is null`);
    expect(events).toHaveLength(1); // not hidden-from: one event, Rabaed's, counted for K1 who reads it
    // At its Version's Cancelled Step, as a Member's Cancel leaves it, so every reader reads it Cancelled.
    const [seen] = await call<{ stage_key: string }>(k1.member, sql`select stage_key from app.step_as_seen(${submitted}::uuid)`);
    expect(seen!.stage_key).toBe("cancelled");
  });

  // Pinned as built, an open question for the owner (RP-952 PR 1): a Version with no Cancelled Step leaves the item
  // Cancelled at the Step it was at, so the List reads its Stage there. Whichever fix is picked changes this test.
  it("leaves an item whose Version has no Cancelled Step Cancelled at the Step it was at", async () => {
    const state = await itemState(noCancelStep);
    expect([state.outcome, state.closed_at !== null, await recordQueued(noCancelStep)]).toEqual(["cancelled", true, true]);
    expect((await migrator.query("select current_step_id from work_item where id = $1", [noCancelStep])).rows[0].current_step_id).toBe(noCancelStepAt);
    const [seen] = await call<{ stage_key: string }>(k1.member, sql`select stage_key from app.step_as_seen(${noCancelStep}::uuid)`);
    expect(seen!.stage_key).not.toBe("cancelled");
  });

  it("cancels the Draft and the Draft Revision with no Record, and nobody reads them", async () => {
    for (const id of [c2Draft, revision]) {
      const state = await itemState(id);
      expect(state.outcome).toBe("cancelled");
      expect(state.discarded_at).not.toBeNull();
      expect(await recordQueued(id)).toBe(false);
      for (const as of [c1.ap, c1.member, k1.member, c2.member]) {
        // not hidden-from: nobody may read a withdrawn Company's Draft any more, so no viewer is left to read it first; the test above read it as C2 before the withdrawal.
        expect(await itemRows(id)(as), `${nameOf(as)} reads ${id}`).toEqual([]); // not hidden-from: nobody may read it any more (proved before the withdrawal)
      }
    }
  });
});

describe("scenario RP-952-3: C1's Project Admin withdraws K1 while K1 holds C1's item: a Participant-level Vacancy", () => {
  let item = "";
  let enteredAt: Date | null = null;

  beforeAll(async () => {
    item = await atK1(c1.member, c1Pm, "WDPR-V");
    vacantItem = item;
    // K1 Sends it Back once, so a move of K1's stays in C1's history; C1 Submits it again and K1 picks it up.
    expect(await take(k1.member, item, "send_back")).toBe("applied");
    expect(await take(c1Pm, item, "submit")).toBe("applied");
    expect(await pickUp(k1.member, item)).toBe("picked_up");
    [{ entered_at: enteredAt }] = (await call<{ entered_at: Date }>(c1.member, sql`select entered_at from app.step_as_seen(${item}::uuid)`)) as [{ entered_at: Date }];
  });

  it("the preview counts the Step that becomes a Vacancy, and no item, since K1 raised none", async () => {
    expect(await preview(c1.ap, participant.k1)).toEqual({ outcome: "ok", items_to_cancel: 0, steps_to_vacate: 1 });
  });

  it("before: C1 reads K1 as the item's holder", async () => {
    const holder = await call<{ participant_id: string }>(c1.member, sql`select participant_id from app.work_item_holder(${item}::uuid)`);
    expect(holder.map((h) => h.participant_id)).toEqual([participant.k1]);
  });

  it("turns K1's Step into a Vacancy that no Company holds", async () => {
    expect(await withdraw(c1.ap, participant.k1)).toBe("withdrawn");
    const { rows } = await migrator.query("select status, assignee_member_id from step_assignment where work_item_id = $1 and status not in ('done', 'reassigned')", [item]);
    expect(rows).toEqual([{ status: "vacant", assignee_member_id: null }]);
    for (const as of [c1.member, c1Pm]) {
      // not hidden-from: after the withdrawal no reader has a holder for the item (the Vacancy holds it); the test before read K1 as its holder.
      expect(await call(as, sql<{ participant_id: string }>`select participant_id from app.work_item_holder(${item}::uuid)`), `${nameOf(as)}'s holder`).toEqual([]); // not hidden-from: no reader has a holder now (K1 was read as holder before)
      const [seen] = await call<{ holder_participant_id: string | null; holder_company_name: unknown }>(
        as,
        sql`select holder_participant_id, holder_company_name from app.work_items_seen(${projectId}::uuid, array['submittals'], false, array[${item}::uuid])`,
      );
      expect(seen, `${nameOf(as)}'s List row`).toEqual({ holder_participant_id: null, holder_company_name: null });
    }
  });

  it("names only K1's Project Role to whoever sees the item, never to anyone else", async () => {
    await expectHiddenFrom({
      read: (as) => call<{ base_role: string }>(as, sql`select base_role from app.work_item_vacancy(${item}::uuid)`),
      idOf: (row) => `${item}:${row.base_role}`,
      target: `${item}:consultant`,
      seenBy: [c1.member, c1Pm],
      // C1's Project Admin is on the Project with no Visibility of the item, so not even its role.
      hiddenFrom: [c2.member, k1.member, c1.ap],
      name: nameOf,
      label: "the Vacancy's role",
    });
  });

  it("keeps the item's Step Age counting from when it reached K1", async () => {
    const [seen] = await call<{ entered_at: Date }>(c1.member, sql`select entered_at from app.step_as_seen(${item}::uuid)`);
    expect(seen!.entered_at).toEqual(enteredAt);
  });

  it("lists the Vacancy for C1's Project Admins only", async () => {
    const { rows: assignment } = await migrator.query("select id from step_assignment where work_item_id = $1 and status = 'vacant'", [item]);
    await expectHiddenFrom({ read: vacancies, target: assignment[0].id, seenBy: [c1.ap, c1Admin], hiddenFrom: [c1.member, c1Pm, c2.ap, k1.ap, other.ap], name: nameOf, label: "the Vacancies list" });
  });

  it("names the item to a Project Admin who sees it, and only its role to one who doesn't (as RP-511's Handover list)", async () => {
    const { rows: assignment } = await migrator.query("select id from step_assignment where work_item_id = $1 and status = 'vacant'", [item]);
    const theRow = async (as: string) => (await vacancies(as)).filter((v) => v.id === assignment[0].id);
    // The item's id, Document Number and Subject, to the second Admin only; C1's Authorized Person has no Visibility of it.
    await expectHiddenFrom({
      read: async (as) => (await theRow(as)).flatMap((v) => (v.work_item_id && v.document_number && v.title ? [{ id: v.work_item_id }] : [])),
      target: item,
      seenBy: c1Admin,
      hiddenFrom: c1.ap,
      name: nameOf,
      label: "the Vacancy's item",
    });
    const [roleOnly] = await theRow(c1.ap);
    expect(roleOnly).toMatchObject({ work_item_id: null, document_number: null, title: null, base_role: "consultant" });
  });
});

describe("scenario RP-952-4: the withdrawal's notices reach K1's Authorized Person and Project Members only", () => {
  it("gives each of them one in-app notice, naming the Host Company and the Project", async () => {
    for (const as of [k1.ap, k1.member, k1Manager]) {
      const notices = await withdrawalNotices(as);
      expect(notices, nameOf(as)).toHaveLength(1); // not hidden-from: one notice delivered, the positive side
      const [notice] = await call<{ project_code: string; project_name: unknown; host_company_name: unknown }>(
        as,
        sql`select project_code, project_name, host_company_name from app.withdrawal_notice(${notices[0]!.id}::uuid)`,
      );
      expect(notice, nameOf(as)).toEqual({ project_code: "WDP", project_name: { en: "Tower", ar: "برج" }, host_company_name: { en: "C1", ar: "C1" } });
    }
  });

  it("queues one email for each of them, which names the Host Company and not the person", async () => {
    const { rows } = await migrator.query(
      "select e.* from outbox o cross join lateral app.participant_withdrawn_email((o.payload ->> 'participantId')::uuid, (o.payload ->> 'memberId')::uuid) e where o.kind = 'participant_withdrawn' and o.payload ->> 'participantId' = $1",
      [participant.k1],
    );
    expect(rows.map((r) => r.to_address).sort()).toHaveLength(3); // not hidden-from: one email for each of K1's three
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["host_company_name", "language", "project_name", "to_address"]);
      expect(r.host_company_name).toEqual({ en: "C1", ar: "C1" });
    }
  });

  it("gives a Member nothing from the email's read, even with the right ids: it is the worker's alone", async () => {
    const [k1Engineer] = (await migrator.query("select o.payload ->> 'memberId' as id from outbox o where o.kind = 'participant_withdrawn' and o.payload ->> 'participantId' = $1 limit 1", [participant.k1])).rows as { id: string }[];
    const query = sql<{ to_address: string }>`select to_address from app.participant_withdrawn_email(${participant.k1}::uuid, ${k1Engineer!.id}::uuid)`;
    const { rows: [email] } = await query.execute(app);
    // The worker (the app role with no Member set) reads the address; no Member does, whatever ids they hold.
    await expectHiddenFrom({
      read: async (as: string) => (as === "worker" ? (await query.execute(app)).rows : await call(as, query)),
      idOf: (row) => row.to_address,
      target: email!.to_address,
      seenBy: "worker",
      hiddenFrom: [c1.ap, k1.ap, k1.member],
      name: (as) => (as === "worker" ? "the worker" : nameOf(as)),
      label: "the withdrawal email's read",
    });
  });

  it("gives nobody else a withdrawal notice", async () => {
    for (const as of [c1.ap, c1.member, c1Pm]) {
      // not hidden-from: no notice is made for them, so there is no row to read first; K1's notices above prove the delivery ran.
      expect(await withdrawalNotices(as), nameOf(as)).toEqual([]); // not hidden-from: no notice is made for them
    }
    // C2's Members hold only the notice of C2's own withdrawal, none of K1's.
    for (const as of [c2.ap, c2.member, c2Pm]) expect(await withdrawalNotices(as), nameOf(as)).toHaveLength(1); // not hidden-from: only their own withdrawal's notice
    const notice = (await withdrawalNotices(k1.member))[0]!.id;
    // Nobody reads another Member's notice, nor its Project and Host Company.
    await expectHiddenFrom({
      read: (as) => call<{ id: string }>(as, sql`select ${notice}::uuid as id from app.withdrawal_notice(${notice}::uuid)`),
      target: notice,
      seenBy: k1.member,
      hiddenFrom: [k1Manager, k1.ap, c1.ap, c1.member],
      name: nameOf,
      label: "another Member's notice",
    });
  });
});

describe("scenario RP-952-5: after the withdrawal, K1's Members lose the Project, and what K1 did stays", () => {
  let item = "";

  beforeAll(() => {
    item = vacantItem;
  });

  it("K1's Members no longer read the Project or its items", async () => {
    await expectHiddenFrom({ read: itemRows(item), target: item, seenBy: [c1.member, c1Pm], hiddenFrom: [k1.member, k1Manager, k1.ap], name: nameOf, label: "the item" });
    await expectHiddenFrom({
      read: (as) => call<{ id: string }>(as, sql`select id from project where id = ${projectId}::uuid`),
      target: projectId,
      seenBy: [c1.member, c1.ap],
      hiddenFrom: [k1.member, k1Manager, k1.ap, c2.member, c2.ap],
      name: nameOf,
      label: "the Project",
    });
  });

  it("C1 still reads K1's Send Back in the item's history", async () => {
    const events = await call<{ id: string }>(
      c1.member,
      sql`select e.id from work_item_event e where e.work_item_id = ${item}::uuid and e.type = 'transition' and e.actor_participant_id = ${participant.k1}::uuid`,
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("refuses a second withdrawal as for an id that does not exist", async () => {
    expect(await withdraw(c1.ap, participant.k1)).toBe("not_found");
    expect((await preview(c1.ap, participant.k1)).outcome).toBe("not_found");
  });
});

describe("scenario RP-952-6: the Vacancies list names each Vacancy's Step, and nothing more of an item the Admin doesn't see", () => {
  const vacancySteps = (as: string) =>
    call<{ id: string; work_item_id: string | null; document_number: string | null; title: string | null; step_name: { en: string; ar: string } }>(
      as,
      sql`select step_assignment_id as id, work_item_id, document_number, title, step_name from app.project_vacancies(${projectId}::uuid)`,
    );
  let assignment = "";
  let stepName: { en: string; ar: string } = { en: "", ar: "" };

  beforeAll(async () => {
    const { rows } = await migrator.query(
      "select a.id, s.name from step_assignment a join workflow_step s on s.id = a.step_id where a.work_item_id = $1 and a.status = 'vacant'",
      [vacantItem],
    );
    assignment = rows[0].id as string;
    stepName = rows[0].name as { en: string; ar: string };
  });

  it("gives both of C1's Project Admins the Step, and nobody else", async () => {
    await expectHiddenFrom({
      // Every Vacancy row carries its Step (the test after this one checks it), so the row's id stands for it.
      read: async (as) => (await vacancySteps(as)).map((v) => ({ id: v.id })),
      target: assignment,
      seenBy: [c1.ap, c1Admin],
      hiddenFrom: [c1.member, c1Pm, c2.ap, k1.ap, other.ap],
      name: nameOf,
      label: "the Vacancy's Step",
    });
  });

  it("gives the Admin who doesn't see the item its Step and role only, never its id, Document Number or Subject", async () => {
    const [unseen] = (await vacancySteps(c1.ap)).filter((v) => v.id === assignment);
    expect(unseen).toEqual({ id: assignment, work_item_id: null, document_number: null, title: null, step_name: stepName });
    const [seen] = (await vacancySteps(c1Admin)).filter((v) => v.id === assignment);
    expect(seen).toMatchObject({ work_item_id: vacantItem, step_name: stepName });
  });
});

describe("scenario RP-952-7: only the Host Company's Project Admins read the withdrawn Participants", () => {
  const withdrawn = (as: string) =>
    call<{ participant_id: string; base_role: string; withdrawn_at: Date }>(
      as,
      sql`select participant_id, base_role, withdrawn_at from app.project_withdrawn_participants(${projectId}::uuid)`,
    );
  const active = (as: string) => call<{ participant_id: string }>(as, sql`select participant_id from app.project_participants(${projectId}::uuid)`);

  it("lists C2 and K1, with their Company and Project Role, to C1's Project Admins and nobody else", async () => {
    for (const p of [participant.c2, participant.k1]) {
      await expectHiddenFrom({
        read: async (as) => (await withdrawn(as)).map((r) => ({ id: r.participant_id })),
        target: p,
        seenBy: [c1.ap, c1Admin],
        hiddenFrom: [c1.member, c1Pm, c2.ap, k1.ap, other.ap],
        name: nameOf,
        label: "the withdrawn Participants",
      });
    }
    const rows = await withdrawn(c1.ap);
    expect(rows.map((r) => [r.participant_id, r.base_role]).sort()).toEqual(
      [
        [participant.c2, "contractor"],
        [participant.k1, "consultant"],
      ].sort(),
    );
    for (const r of rows) expect(r.withdrawn_at).toBeInstanceOf(Date);
  });

  it("never lists them among the Project's active Participants, nor the Host Company among the withdrawn", async () => {
    // Positive control: the same read lists C1, the Host Company, to its Project Admin.
    const ids = (await active(c1.ap)).map((r) => r.participant_id);
    expect(ids).toContain(participant.c1);
    expect(ids).not.toContain(participant.c2); // not hidden-from: the active list, whose positive control is C1's own row above
    expect(ids).not.toContain(participant.k1); // not hidden-from: the active list, as above
    expect((await withdrawn(c1.ap)).map((r) => r.participant_id)).not.toContain(participant.c1); // not hidden-from: C1 is not withdrawn; C2 and K1 are read above
  });
});
