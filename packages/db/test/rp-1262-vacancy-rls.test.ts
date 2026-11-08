// Seam 2 for passing a withdrawn Participant's Vacancies to the replacement Participant's Step Pool
// (RP-1262; ADR 0028; GLOSSARY › Vacancy; workflow-engine.md §9; scenarios RP-1262-1 to RP-1262-4),
// as the app role, with app.pass_vacancies called directly for the overlap. The replacement is the one
// active Participant of the withdrawn Participant's Project Role whose Visibility covers the item; it
// takes the Step when it accepts or when its Visibility is set, and nobody else gains the item.
//
// The describes run in order on one Project "Tower": C1 the Host Company, K1 the Consultant holding
// C1's item when it is withdrawn, C2 a Contractor; K2, K3 and K4 Consultants joining after.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "VHPR";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // The Host Company: its Authorized Person created the Project and is its Project Admin.
let k1: Company; // The Consultant withdrawn while it holds C1's item.
let c2: Company; // A Contractor, on the Project throughout.
let k2: Company; // The replacement Consultant.
let k3: Company; // A Consultant joining with no Visibility, then (RP-1262-4) with all of it.
let k4: Company; // A Consultant overlapping K3 (RP-1262-4), then given Visibility of Building A only (RP-1262-5).
let k5: Company; // A Consultant covering everything, there when K4 is withdrawn (RP-1262-6).
let c1Pm = "";
let k1Manager = "";
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
const participant = { c1: "", k1: "", c2: "", k2: "", k3: "", k4: "", k5: "" };
let itemA = ""; // C1's item K1 held when it was withdrawn.
let itemB = ""; // C1's item K2 held when it was withdrawn (RP-1262-4).
let k1WithdrawnAt: Date;

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

async function addType(code: string) {
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
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withCancel: true });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${code}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Pass a Vacancy", "ar": "نقل الشاغر"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${code}', '{"en": "Pass a Vacancy", "ar": "نقل الشاغر"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** C1's engineer raises an item, C1's PM Submits it, and `holder` (the Consultant's engineer) picks it up. */
async function heldBy(holder: string, model: string, location = buildingA): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${location}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  expect(await pickUp(holder, id)).toBe("picked_up");
  return id;
}

const withdraw = (id: string) => outcome(c1.ap, sql`select app.withdraw_participant(${id}::uuid, now()) as outcome`);
type Grant = { isAll: boolean; values?: string[] };
/** C1's Project Admin saves Participant `id`'s Visibility as the api does: each dimension given, then the hand-off once, in one transaction. */
const saveVisibility = (id: string, grants: { trade?: Grant; location?: Grant }) =>
  withMember(app, c1.ap, async (trx) => {
    for (const [kind, grant] of Object.entries(grants)) {
      const { rows } = await sql<{ outcome: string }>`
        select app.set_participant_visibility(${id}::uuid, ${kind}, ${grant.isAll}, ${grant.values ?? []}::uuid[], now()) as outcome`.execute(trx);
      if (rows[0]!.outcome !== "set") return rows[0]!.outcome;
    }
    await sql`select app.pass_vacancies_after_visibility(${id}::uuid, now())`.execute(trx);
    return "set";
  });
const setVisibility = (id: string, kind: "trade" | "location", isAll: boolean, values: string[] = []) => saveVisibility(id, { [kind]: { isAll, values } });
const coverAll = async (id: string) => expect(await saveVisibility(id, { trade: { isAll: true }, location: { isAll: true } })).toBe("set");
/** `co`'s engineer on Participant `p`, with every Visibility of it and the engineer Position. */
async function onProject(co: Company, p: string, m = co.member, positions = ["engineer"]) {
  await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
}

// The item's Steps, as the database holds them (the migrator's read).
const steps = async (id: string) =>
  (await migrator.query("select participant_id, assignee_member_id, status from step_assignment where work_item_id = $1 order by created_at, id", [id])).rows as {
    participant_id: string;
    assignee_member_id: string | null;
    status: string;
  }[];
const openStep = async (id: string) => (await steps(id)).find((s) => ["pooled", "picked_up", "vacant"].includes(s.status));
const itemRows = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);
const vacancies = (as: string) =>
  call<{ work_item_id: string | null }>(as, sql`select work_item_id from app.project_vacancies(${projectId}::uuid)`);
const vacancy = (as: string, id: string) => call<{ base_role: string }>(as, sql`select base_role from app.work_item_vacancy(${id}::uuid)`);
const holder = (as: string, id: string) => call<{ participant_id: string }>(as, sql`select participant_id from app.work_item_holder(${id}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType(TYPE);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  k2 = await company(engineer, "K2");
  k3 = await company(engineer, "K3");
  k4 = await company(engineer, "K4");
  k5 = await company(engineer, "K5");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");
  for (const [as, name] of [
    [c1.ap, "C1's Project Admin"],
    [c1.member, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.ap, "K1's Authorized Person"],
    [k1.member, "the K1 engineer"],
    [k1Manager, "the K1 manager"],
    [c2.ap, "C2's Authorized Person"],
    [c2.member, "the C2 engineer"],
    [k2.ap, "K2's Authorized Person"],
    [k2.member, "the K2 engineer"],
    [k3.ap, "K3's Authorized Person"],
    [k3.member, "the K3 engineer"],
    [k4.ap, "K4's Authorized Person"],
    [k4.member, "the K4 engineer"],
    [k5.ap, "K5's Authorized Person"],
    [k5.member, "the K5 engineer"],
  ] as const)
    names.set(as, name);
  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'VHP', 'contractor')`);
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
  await value("trade", "PL");
  buildingB = await value("location", "BB");
  for (const p of [participant.c1, participant.k1, participant.c2]) await coverAll(p);
  await onProject(c1, participant.c1);
  await onProject(c1, participant.c1, c1Pm, ["project_manager"]);
  // C1's Project Admin is on the Project too, with no Position, so the Vacancies list names the items to them.
  await call(c1.ap, sql<{ outcome: string }>`select app.add_project_member(${participant.c1}::uuid, ${c1.ap}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await outcome(c1.ap, sql`select app.set_member_visibility(${participant.c1}::uuid, ${c1.ap}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  await onProject(k1, participant.k1);
  await onProject(k1, participant.k1, k1Manager, ["manager"]);
  await onProject(c2, participant.c2);
  itemA = await heldBy(k1.member, "Cable tray");
  k1WithdrawnAt = new Date();
  expect(await withdraw(participant.k1)).toBe("withdrawn");
  expect((await openStep(itemA))?.status).toBe("vacant");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1262-1: the Vacancy passes to the replacement's Step Pool once it covers the item", () => {
  it("waits while the replacement is only accepted, and while it covers one dimension of two", async () => {
    participant.k2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k2.cr, role: "consultant" }, k2.ap);
    await onProject(k2, participant.k2);
    expect((await openStep(itemA))?.status, "accepted, with no Visibility").toBe("vacant");
    expect(await setVisibility(participant.k2, "trade", true)).toBe("set");
    expect((await openStep(itemA))?.status, "with its Trades only").toBe("vacant");
    await expectHiddenFrom({ read: itemRows(itemA), target: itemA, seenBy: c1.member, hiddenFrom: [k2.ap, k2.member], name: nameOf, label: "before the hand-off" });
    // Still "Waiting for a new Consultant", and on the Vacancies card.
    expect(await vacancy(c1.member, itemA)).toEqual([{ base_role: "consultant" }]);
    expect((await vacancies(c1.ap)).map((v) => v.work_item_id)).toContain(itemA);
  });

  it("passes once it covers the item: its pool of one holds it, and the old Step is kept as reassigned", async () => {
    const before = new Date();
    expect(await setVisibility(participant.k2, "location", true)).toBe("set");
    const k1Steps = (await steps(itemA)).filter((s) => s.participant_id === participant.k1);
    expect(k1Steps).toEqual([{ participant_id: participant.k1, assignee_member_id: null, status: "reassigned" }]);
    expect(await openStep(itemA)).toEqual({ participant_id: participant.k2, assignee_member_id: k2.member, status: "picked_up" });
    // Step Age restarts at the hand-off, for every reader.
    const { rows } = await migrator.query("select participant_entered_at, step_entered_at from work_item where id = $1", [itemA]);
    expect(rows[0].participant_entered_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(rows[0].step_entered_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // "Step reached" is queued for the new assignment.
    const queued = await migrator.query(
      "select 1 from outbox where kind = 'notification' and payload ->> 'step_assignment_id' = (select id::text from step_assignment where work_item_id = $1 and participant_id = $2)",
      [itemA, participant.k2],
    );
    expect(queued.rowCount).toBe(1);
  });

  it("is read by the replacement's engineer, and by C1 as held by K2, with no Vacancy left", async () => {
    expect(await itemRows(itemA)(k2.member)).toEqual([{ id: itemA }]);
    expect(await holder(c1.member, itemA)).toEqual([{ participant_id: participant.k2 }]);
    expect(await vacancy(c1.member, itemA), "no 'Waiting for a new Consultant'").toEqual([]); // not hidden-from: the same read gave the role before the hand-off
    expect(await vacancies(c1.ap), "the Vacancies card").toEqual([]); // not hidden-from: the same Admin's read listed it before the hand-off
  });

  it("writes one shared event, Rabaed's own, naming K2 and no withdrawn Participant", async () => {
    const { rows } = await migrator.query(
      "select actor_member_id, actor_engineer_id, actor_participant_id, payload, audience from work_item_event where work_item_id = $1 and type = 'assigned' and audience = 'shared'",
      [itemA],
    );
    expect(rows).toEqual([{ actor_member_id: null, actor_engineer_id: null, actor_participant_id: participant.k2, payload: { vacancy: true }, audience: "shared" }]);
    const history = await call<{ type: string; audience: string; company_name: { en: string } | null; member_name: unknown }>(
      c1.member,
      sql`select type, audience, company_name, member_name from app.work_item_history(${itemA}::uuid)`,
    );
    // C1's own pool-of-one events are internal to C1; the hand-off is the one shared `assigned` event.
    expect(history.filter((e) => e.type === "assigned" && e.audience === "shared")).toEqual([{ type: "assigned", audience: "shared", company_name: { en: "K2", ar: "K2" }, member_name: null }]);
  });
});

describe("scenario RP-1262-2: no other Participant gains the item", () => {
  it("leaves it unread by C2 and by a Consultant covering nothing, and gives access to K2 alone", async () => {
    participant.k3 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k3.cr, role: "consultant" }, k3.ap);
    await onProject(k3, participant.k3);
    await expectHiddenFrom({ read: itemRows(itemA), target: itemA, seenBy: [k2.member, c1.member], hiddenFrom: [c2.ap, c2.member, k3.ap, k3.member], name: nameOf, label: "the item" });
    const { rows } = await migrator.query("select participant_id from work_item_access where work_item_id = $1 order by participant_id", [itemA]);
    expect(rows.map((r) => r.participant_id).sort()).toEqual([participant.c1, participant.k1, participant.k2].sort());
  });
});

describe("scenario RP-1262-3: the withdrawn Company reads nothing new", () => {
  it("leaves K1's Members without the item, the Project or a notice since its withdrawal", async () => {
    const k1s = [k1.ap, k1.member, k1Manager];
    await expectHiddenFrom({ read: itemRows(itemA), target: itemA, seenBy: k2.member, hiddenFrom: k1s, name: nameOf, label: "the item" });
    const project = (as: string) => call<{ id: string }>(as, sql`select id from project where id = ${projectId}::uuid`);
    await expectHiddenFrom({ read: project, target: projectId, seenBy: k2.member, hiddenFrom: k1s, name: nameOf, label: "the Project" });
    for (const as of k1s) {
      const { rows } = await migrator.query("select kind from notification where member_id = $1 and created_at > $2 and kind <> 'participant_withdrawn'", [
        as,
        k1WithdrawnAt,
      ]);
      expect(rows, nameOf(as)).toEqual([]); // not hidden-from: the migrator's read: no notification was made for them at all
    }
  });
});

describe("scenario RP-1262-4: with two covering Consultants nobody is picked; narrowing one passes it to the other", () => {
  it("keeps the Vacancies while K3 and K4 both cover the items, then gives them to K3 when K4 is narrowed", async () => {
    itemB = await heldBy(k2.member, "Busbar");
    await coverAll(participant.k3);
    participant.k4 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k4.cr, role: "consultant" }, k4.ap);
    await onProject(k4, participant.k4);
    await coverAll(participant.k4);
    expect(await withdraw(participant.k2)).toBe("withdrawn");
    for (const id of [itemA, itemB]) expect((await openStep(id))?.status).toBe("vacant");
    expect((await migrator.query("select app.pass_vacancies($1, now()) as passed", [projectId])).rows[0].passed).toBe(0);
    for (const id of [itemA, itemB]) expect((await openStep(id))?.status, "two candidates").toBe("vacant");
    expect((await vacancies(c1.ap)).map((v) => v.work_item_id).sort()).toEqual([itemA, itemB].sort());
    // Under the Overlap, neither covering Consultant gains either item.
    for (const id of [itemA, itemB]) {
      await expectHiddenFrom({ read: itemRows(id), target: id, seenBy: c1.member, hiddenFrom: [k3.ap, k3.member, k4.ap, k4.member], name: nameOf, label: "under the Overlap" });
    }
    expect(await setVisibility(participant.k4, "trade", false, [])).toBe("set");
    for (const id of [itemA, itemB]) {
      expect(await openStep(id), "K3's pool of one").toEqual({ participant_id: participant.k3, assignee_member_id: k3.member, status: "picked_up" });
      await expectHiddenFrom({ read: itemRows(id), target: id, seenBy: [k3.member, c1.member], hiddenFrom: [k4.ap, k4.member, k2.member, c2.member], name: nameOf, label: "the item" });
    }
    expect(await vacancies(c1.ap)).toEqual([]); // not hidden-from: the same Admin's read listed both just before
  });
});

let itemC = ""; // C1's item at Building B, held by K3 when it is withdrawn (RP-1262-5).

describe("scenario RP-1262-5: a Visibility change of several values that passes a Vacancy is saved in full", () => {
  it("judges the whole change, not half of it: K4's new Trade and Location pass the Building A items, not Building B's", async () => {
    itemC = await heldBy(k3.member, "Conduit", buildingB);
    expect(await withdraw(participant.k3)).toBe("withdrawn");
    for (const id of [itemA, itemB, itemC]) expect((await openStep(id))?.status, "nobody covers them yet").toBe("vacant");
    // Half the change (Electrical, with K4's every Location) would cover itemC too.
    expect(await saveVisibility(participant.k4, { trade: { isAll: false, values: [electrical] }, location: { isAll: false, values: [buildingA] } })).toBe("set");
    const grants = await call<{ kind: string; is_all: boolean; value_ids: string[] }>(c1.ap, sql`select kind, is_all, value_ids from app.participant_grants(${participant.k4}::uuid)`);
    expect(grants).toEqual([
      { kind: "location", is_all: false, value_ids: [buildingA] },
      { kind: "trade", is_all: false, value_ids: [electrical] },
    ]);
    for (const id of [itemA, itemB]) expect(await openStep(id), "K4's pool of one").toEqual({ participant_id: participant.k4, assignee_member_id: k4.member, status: "picked_up" });
    expect((await openStep(itemC))?.status, "Building B is not K4's").toBe("vacant");
    await expectHiddenFrom({ read: itemRows(itemC), target: itemC, seenBy: c1.member, hiddenFrom: [k4.ap, k4.member], name: nameOf, label: "Building B's item" });
  });
});

describe("scenario RP-1262-6: a withdrawal passes a Vacancy at once to the one other Participant of the role covering it", () => {
  it("gives K4's items to K5 as K4 is withdrawn, and nobody else gains them", async () => {
    participant.k5 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k5.cr, role: "consultant" }, k5.ap);
    await onProject(k5, participant.k5);
    await coverAll(participant.k5);
    // Building B's Vacancy was K5's alone to cover: it passed as K5 was given Visibility.
    expect(await openStep(itemC)).toEqual({ participant_id: participant.k5, assignee_member_id: k5.member, status: "picked_up" });
    expect(await withdraw(participant.k4)).toBe("withdrawn");
    for (const id of [itemA, itemB]) {
      expect(await openStep(id), "passed at the withdrawal").toEqual({ participant_id: participant.k5, assignee_member_id: k5.member, status: "picked_up" });
      await expectHiddenFrom({ read: itemRows(id), target: id, seenBy: [k5.member, c1.member], hiddenFrom: [k4.ap, k4.member, k3.member, k2.member, c2.member], name: nameOf, label: "after K4's withdrawal" });
    }
    expect(await vacancies(c1.ap)).toEqual([]); // not hidden-from: the same Admin's read listed Vacancies in RP-1262-4
  });
});
