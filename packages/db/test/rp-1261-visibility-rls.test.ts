// Seam 2 for inviting a withdrawn Company again (RP-1261, ADR 0028: "A withdrawn Company comes back
// only through a new Invitation"; visibility.md "A Participant's withdrawal"; scenarios RP-1261-1 to
// RP-1261-3), as the app role. A new Invitation accepted by a withdrawn Company makes a fresh
// Participant: a new row with a new id, beside the withdrawn one, which stays exactly as it was with
// its Cancelled items and its Vacancies. Its Members read what any new Participant reads: the
// earlier participation reopens nothing, and their link to the withdrawn Participant counts for
// nothing (Visibility, Assign, the weekly Step Age report). E2 (Signatory Access) is RP-614's, not
// built yet, so "plus E2" adds nothing here.
//
// The describes run in order on one Project. Setup: C1 the Host Company, K1 the Consultant, C2 and C3
// Contractors. C2's item at K1 and C3's item at K1 are Cancelled by their withdrawals; C1's item at K1
// becomes a Vacancy by K1's. Then C2 and K1 are invited again in their roles and accept; C3 is not.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "RIWP";
// A test-only Position holding Assign (no seeded one does), removed again at the end: Positions are shared.
const LEAD = "reinvite_lead";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // The Host Company: its Authorized Person created the Project and is its Project Admin.
let k1: Company; // The Consultant: holds the Contractors' items at review; withdrawn, then back.
let c2: Company; // A Contractor: withdrawn, then back.
let c3: Company; // A Contractor: withdrawn, never invited again.
let c1Pm = "";
let c2Pm = "";
let c3Pm = "";
let k1Lead = ""; // On the withdrawn K1 with Assign and every Location; on the new K1 without Assign, at Building A only.
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
const old = { k1: "", c2: "", c3: "" }; // The withdrawn Participants.
const fresh = { k1: "", c2: "" }; // The Participants the new Invitations made.
let c1Participant = "";
let vacantItem = ""; // C1's item K1 held when it was withdrawn: a Vacancy.
let c2Cancelled = ""; // C2's item at K1, Cancelled by C2's withdrawal.
let c2Draft = ""; // C2's Draft, Cancelled with no Record.
let c3Cancelled = ""; // C3's item at K1, Cancelled by C3's withdrawal.
let c1New = ""; // C1's item at the K1 that is back (RP-1261-1).

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

async function addType() {
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
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Invite again", "ar": "دعوة مجددا"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Invite again", "ar": "دعوة مجددا"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

async function draft(as: string, model: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** `engineer` sends the Draft for review and `pm` Submits it: it waits for the Consultant, whose `reviewer` picks it up. */
async function atConsultant(engineer: string, pm: string, reviewer: string, model: string): Promise<string> {
  const id = await draft(engineer, model);
  expect(await take(engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, id, "submit")).toBe("applied");
  expect(await pickUp(reviewer, id)).toBe("picked_up");
  return id;
}

/** Adds `memberId` to Participant `participantId` with `positions`, every Trade, and every Location or only `location`. */
async function onProject(co: Company, participantId: string, memberId: string, positions: string[], location: string | null = null) {
  expect(await outcome(co.ap, sql`select app.add_project_member(${participantId}::uuid, ${memberId}::uuid, now()) as outcome`)).toBe("added");
  expect(await outcome(co.ap, sql`select app.set_member_visibility(${participantId}::uuid, ${memberId}::uuid, 'trade', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  const values = location === null ? [] : [location];
  expect(
    await outcome(
      co.ap,
      sql`select app.set_member_visibility(${participantId}::uuid, ${memberId}::uuid, 'location', ${location === null}, ${values}::uuid[], now()) as outcome`,
    ),
  ).toBe("set");
  expect(await outcome(co.ap, sql`select app.set_project_member_positions(${participantId}::uuid, ${memberId}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
}

async function allVisibility(participantId: string) {
  for (const kind of ["trade", "location"]) {
    expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
}

const invite = (co: Company, role: string) => outcome(c1.ap, sql`select app.add_participant(${projectId}::uuid, ${co.cr}, ${role}, now()) as outcome`);
const withdraw = (id: string) => outcome(c1.ap, sql`select app.withdraw_participant(${id}::uuid, now()) as outcome`);
/** The Authorized Person's pending invitations on this Project. */
const pending = (co: Company) => call<{ participant_id: string }>(co.ap, sql`select participant_id from app.company_invitations()`);
const accept = (co: Company, id: string) => outcome(co.ap, sql`select app.respond_to_invitation(${id}::uuid, true, now()) as outcome`);

// The reads, each as the app role.
const itemRows = (id: string) => (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);
const projectItems = (as: string) => call<{ id: string }>(as, sql`select id from work_item where project_id = ${projectId}::uuid order by id`);
const seen = (as: string) =>
  call<{ id: string; holder_participant_id: string | null }>(
    as,
    sql`select id, holder_participant_id from app.work_items_seen(${projectId}::uuid, array['submittals'], false, null)`,
  );
const myProjects = (as: string) => call<{ id: string }>(as, sql`select x as id from app.current_project_ids() x`);
const vacancies = (as: string) =>
  call<{ id: string; work_item_id: string | null; base_role: string }>(
    as,
    sql`select step_assignment_id as id, work_item_id, base_role from app.project_vacancies(${projectId}::uuid)`,
  );
const participantRows = (as: string) => call<{ id: string }>(as, sql`select participant_id as id from app.project_participants(${projectId}::uuid)`);
const row = async (id: string) => (await migrator.query("select to_jsonb(p) as row from participant p where p.id = $1", [id])).rows[0].row as Record<string, unknown>;
const assignment = async (itemId: string) =>
  (await migrator.query("select participant_id, status, assignee_member_id from step_assignment where work_item_id = $1 and status <> 'done'", [itemId]))
    .rows as { participant_id: string; status: string; assignee_member_id: string | null }[];

// The withdrawn rows as the withdrawals left them, compared again after the Companies are back.
const before = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  await migrator.query(
    `insert into position (owner_kind, base_role, key, name, sort)
     select 'rabaed', r, $1, '{"en": "Lead (test)", "ar": "قائد (اختبار)"}', 99
     from unnest(array['contractor', 'consultant', 'owner', 'owner_representative']) r
     on conflict (base_role, key) do nothing`,
    [LEAD],
  );
  await migrator.query(
    `insert into position_permission (position_id, module_key, permission)
     select p.id, 'submittals', x from position p cross join unnest(array['view', 'assign']) x where p.key = $1
     on conflict do nothing`,
    [LEAD],
  );
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  c3 = await company(engineer, "C3");
  c1Pm = await member(c1.id, "pm");
  c2Pm = await member(c2.id, "pm");
  c3Pm = await member(c3.id, "pm");
  k1Lead = await member(k1.id, "lead");
  for (const [as, name] of [
    [c1.ap, "C1's Project Admin"],
    [c1.member, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.ap, "K1's Authorized Person"],
    [k1.member, "the K1 engineer"],
    [k1Lead, "the K1 lead"],
    [c2.ap, "C2's Authorized Person"],
    [c2.member, "the C2 engineer"],
    [c2Pm, "the C2 PM"],
    [c3.ap, "C3's Authorized Person"],
    [c3.member, "the C3 engineer"],
    [c3Pm, "the C3 PM"],
  ] as const)
    names.set(as, name);
  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RIW', 'contractor')`);
  projectId = created!.project_id;
  c1Participant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  old.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  old.c2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  old.c3 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c3.cr, role: "contractor" }, c3.ap);
  const value = async (kind: string, valueCode: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, ${JSON.stringify({ en: valueCode, ar: valueCode })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  buildingB = await value("location", "BB");
  for (const p of [c1Participant, old.k1, old.c2, old.c3]) await allVisibility(p);
  expect(await outcome(c1.ap, sql`select app.set_participant_code(${old.k1}::uuid, 'KON') as outcome`)).toBe("set");
  // The Project Admin is on the Project and sees every item, so the Vacancies list names the item to them.
  await onProject(c1, c1Participant, c1.ap, ["engineer"]);
  await onProject(c1, c1Participant, c1.member, ["engineer"]);
  await onProject(c1, c1Participant, c1Pm, ["project_manager"]);
  await onProject(k1, old.k1, k1.member, ["engineer"]);
  await onProject(k1, old.k1, k1Lead, ["manager", LEAD]);
  await onProject(c2, old.c2, c2.member, ["engineer"]);
  await onProject(c2, old.c2, c2Pm, ["project_manager"]);
  await onProject(c3, old.c3, c3.member, ["engineer"]);
  await onProject(c3, old.c3, c3Pm, ["project_manager"]);

  c2Cancelled = await atConsultant(c2.member, c2Pm, k1.member, "RIWP-C2");
  c2Draft = await draft(c2.member, "RIWP-D");
  c3Cancelled = await atConsultant(c3.member, c3Pm, k1.member, "RIWP-C3");
  vacantItem = await atConsultant(c1.member, c1Pm, k1.member, "RIWP-V");
  // The Consultant read the Contractors' items before they left: the rows exist.
  for (const id of [c2Cancelled, c3Cancelled]) expect((await itemRows(id)(k1.member)).map((r) => r.id)).toEqual([id]);
  expect((await itemRows(c2Draft)(c2.member)).map((r) => r.id)).toEqual([c2Draft]);

  for (const p of [old.c2, old.c3, old.k1]) expect(await withdraw(p)).toBe("withdrawn");
  for (const p of [old.c2, old.c3, old.k1]) before.set(p, await row(p));
  // K1's Step on C1's item is a Vacancy.
  expect(await assignment(vacantItem)).toEqual([{ participant_id: old.k1, status: "vacant", assignee_member_id: null }]);
});

afterAll(async () => {
  await migrator?.query("delete from project_member_position where position_id in (select id from position where key = $1)", [LEAD]);
  await migrator?.query("delete from position_permission where position_id in (select id from position where key = $1)", [LEAD]);
  await migrator?.query("delete from position where key = $1", [LEAD]);
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1261-1: a withdrawn Company invited again and accepting is a fresh Participant", () => {
  it("invites it again as for any Company: a new pending invitation with a new id, while it reads nothing", async () => {
    expect(await invite(k1, "consultant")).toBe("invited");
    const [invitation] = await pending(k1);
    fresh.k1 = invitation!.participant_id;
    expect(fresh.k1).not.toBe(old.k1);
    expect((await row(fresh.k1)).status).toBe("invited");
    // Invited, not yet back: its Members read no Project, and the Vacancy stays as it was.
    for (const as of [k1.member, k1Lead]) expect(await myProjects(as), nameOf(as)).toEqual([]); // not hidden-from: no Project id at all; C1's Members read it (RP-1261-2)
    expect(await assignment(vacantItem)).toEqual([{ participant_id: old.k1, status: "vacant", assignee_member_id: null }]);
    // Inviting it again while it is pending sends that same invitation again.
    expect(await invite(k1, "consultant")).toBe("invited");
    expect((await pending(k1)).map((p) => p.participant_id)).toEqual([fresh.k1]);
  });

  it("accepting makes the new row active, with its own position on the Project, and leaves the withdrawn row exactly as it was", async () => {
    expect(await accept(k1, fresh.k1)).toBe("accepted");
    expect(await invite(c2, "contractor")).toBe("invited");
    fresh.c2 = (await pending(c2))[0]!.participant_id;
    expect(fresh.c2).not.toBe(old.c2);
    expect(await accept(c2, fresh.c2)).toBe("accepted");
    for (const [now, was] of [
      [fresh.k1, old.k1],
      [fresh.c2, old.c2],
    ] as const) {
      const r = await row(now);
      expect({ status: r.status, company: r.company_id }).toEqual({ status: "active", company: (await row(was)).company_id });
      expect(r.ordinal).not.toBe((await row(was)).ordinal);
    }
    for (const p of [old.k1, old.c2, old.c3]) expect(await row(p), "the withdrawn row").toEqual(before.get(p));
    // The withdrawn row keeps its Participant Code, so the new one never numbers items as the old one did.
    expect(await outcome(c1.ap, sql`select app.set_participant_code(${fresh.k1}::uuid, 'KON') as outcome`)).toBe("duplicate_code");
    expect(await outcome(c1.ap, sql`select app.set_participant_code(${fresh.k1}::uuid, 'KON2') as outcome`)).toBe("set");
    // Back on the Project, a Company is invited no more than once.
    expect(await invite(k1, "consultant")).toBe("already_participant");
  });

  it("its Members read what any new Participant reads: only the items that reach it now", async () => {
    await allVisibility(fresh.k1);
    await allVisibility(fresh.c2);
    // Its Authorized Person adds its Members again, as a new Participant's would; the lead now at Building A only, without Assign.
    await onProject(k1, fresh.k1, k1.member, ["engineer"]);
    await onProject(k1, fresh.k1, k1Lead, ["engineer"], buildingA);
    await onProject(c2, fresh.c2, c2.member, ["engineer"]);
    await onProject(c2, fresh.c2, c2Pm, ["project_manager"]);
    c1New = await atConsultant(c1.member, c1Pm, k1.member, "RIWP-N1");
    const c2New = await atConsultant(c2.member, c2Pm, k1.member, "RIWP-N2");
    expect(await assignment(c1New)).toEqual([{ participant_id: fresh.k1, status: "picked_up", assignee_member_id: k1.member }]);
    for (const as of [k1.member, k1Lead]) {
      expect(await myProjects(as), nameOf(as)).toEqual([{ id: projectId }]);
      expect((await projectItems(as)).map((r) => r.id), nameOf(as)).toEqual([c1New, c2New].sort());
    }
    for (const as of [c2.member, c2Pm]) expect((await projectItems(as)).map((r) => r.id), nameOf(as)).toEqual([c2New]);
  });

  it("a second withdrawal and Invitation make a third row, the two withdrawn ones kept side by side", async () => {
    // A throwaway round on a second Project, so this Project's rows stay as the scenarios below read them.
    const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Annex", "ar": "ملحق"}'::jsonb, 'RIX', 'contractor')`);
    const annex = created!.project_id;
    const ids: string[] = [];
    for (let round = 0; round < 3; round++) {
      expect(await outcome(c1.ap, sql`select app.add_participant(${annex}::uuid, ${c3.cr}, 'contractor', now()) as outcome`)).toBe("invited");
      const id = (await pending(c3))[0]!.participant_id;
      expect(await accept(c3, id)).toBe("accepted");
      ids.push(id);
      if (round < 2) expect(await withdraw(id)).toBe("withdrawn");
    }
    expect(new Set(ids).size).toBe(3);
    const statuses = (await migrator.query("select id, status from participant where project_id = $1 and company_id = $2", [annex, c3.id])).rows;
    expect(statuses.map((s: { id: string; status: string }) => [s.id, s.status]).sort()).toEqual(
      [
        [ids[0], "withdrawn"],
        [ids[1], "withdrawn"],
        [ids[2], "active"],
      ].sort(),
    );
  });
});

describe("scenario RP-1261-2: nothing of the earlier participation reopens to the Company that is back", () => {
  const back = () => [k1.ap, k1.member, k1Lead, c2.ap, c2.member, c2Pm];

  it("its Members read neither the old items it held nor the ones it raised: the Vacancy, the Cancelled items, the Draft", async () => {
    await expectHiddenFrom({ read: itemRows(vacantItem), target: vacantItem, seenBy: [c1.member, c1Pm], hiddenFrom: back(), name: nameOf, label: "the Vacancy's item" });
    for (const id of [c2Cancelled, c3Cancelled, c2Draft]) {
      for (const as of back()) {
        expect(await itemRows(id)(as), `${nameOf(as)}: an item of the earlier participation`).toEqual([]); // not hidden-from: nobody active reads it since its Companies left; K1's engineer (C2's engineer for the Draft) read it in the setup
      }
    }
  });

  it("the Vacancy stays where it was: the withdrawn K1's, vacant, listed to C1's Project Admin alone, with no holder", async () => {
    expect(await assignment(vacantItem)).toEqual([{ participant_id: old.k1, status: "vacant", assignee_member_id: null }]);
    const [listed] = (await vacancies(c1.ap)).filter((v) => v.work_item_id === vacantItem);
    expect(listed).toMatchObject({ base_role: "consultant" });
    await expectHiddenFrom({ read: vacancies, target: listed!.id, seenBy: c1.ap, hiddenFrom: back(), name: nameOf, label: "the Vacancies list" });
    // C1 reads the item held by nobody: not by the K1 that is back.
    const [mine] = (await seen(c1.member)).filter((r) => r.id === vacantItem);
    expect(mine).toEqual({ id: vacantItem, holder_participant_id: null });
    expect(await call(c1.member, sql<{ participant_id: string }>`select participant_id from app.work_item_holder(${vacantItem}::uuid)`)).toEqual([]); // not hidden-from: no holder exists to hide; the row above reads the item
  });

  it("the List's rows for them hold none of the old items, and no item has the withdrawn K1 as its holder", async () => {
    for (const as of back()) {
      const rows = await seen(as);
      const ids = rows.map((r) => r.id);
      for (const id of [vacantItem, c2Cancelled, c3Cancelled, c2Draft]) expect(ids, `${nameOf(as)}'s List`).not.toContain(id); // not hidden-from: the items checked one by one above; this is the List's read
      expect(rows.map((r) => r.holder_participant_id), nameOf(as)).not.toContain(old.k1); // not hidden-from: the "With" filter's holder ids, which name only active holders
    }
    expect((await seen(c1.member)).map((r) => r.holder_participant_id)).not.toContain(old.k1); // not hidden-from: as above, for C1, who reads the vacant item
  });

  it("their link to the withdrawn K1 counts for nothing: Visibility, Assign and the weekly report come from the new one", async () => {
    // The lead had every Location and Assign on the withdrawn K1; on the new one Building A only, and no Assign.
    const mine = await call<{ kind: string; value_id: string }>(k1Lead, sql`select kind, value_id from app.my_visibility(${projectId}::uuid)`);
    expect(mine.filter((v) => v.kind === "location").map((v) => v.value_id)).toEqual([buildingA]);
    expect(mine.map((v) => v.value_id)).not.toContain(buildingB); // not hidden-from: the lead's own grant, read just above
    expect((await call<{ holds: boolean }>(k1Lead, sql`select app.holds_assign_permission() as holds`))[0]!.holds).toBe(false);
    // The weekly report reaches only a Member holding Assign on the Project: none for the lead, though they see items.
    expect((await projectItems(k1Lead)).length).toBeGreaterThan(0);
    const outboxId = (
      await migrator.query("insert into outbox (kind, project_id, payload) values ('step_age_report', $1, jsonb_build_object('member_id', $2::uuid)) returning id", [
        projectId,
        k1Lead,
      ])
    ).rows[0].id as string;
    try {
      // As the worker: the app role with no Member set.
      const report = (await sql`select * from app.take_step_age_report(${outboxId}::uuid)`.execute(app)).rows;
      expect(report).toEqual([]); // not hidden-from: the report is refused before it reads any item
    } finally {
      await migrator.query("delete from outbox where id = $1", [outboxId]);
    }
  });
});

describe("scenario RP-1261-3: a withdrawn Company never invited again still reads nothing", () => {
  const c3s = () => [c3.ap, c3.member, c3Pm];

  it("reads no Project, no Participant and no item, old or new", async () => {
    await expectHiddenFrom({ read: myProjects, target: projectId, seenBy: [c1.member, k1.member], hiddenFrom: c3s(), name: nameOf, label: "the Project" });
    await expectHiddenFrom({ read: participantRows, target: fresh.k1, seenBy: c1.ap, hiddenFrom: c3s(), name: nameOf, label: "the Participants" });
    await expectHiddenFrom({ read: projectItems, target: c1New, seenBy: [c1.member, k1.member], hiddenFrom: c3s(), name: nameOf, label: "a new item" });
    await expectHiddenFrom({ read: itemRows(vacantItem), target: vacantItem, seenBy: c1.member, hiddenFrom: c3s(), name: nameOf, label: "the Vacancy's item" });
    for (const as of c3s()) expect(await itemRows(c3Cancelled)(as), nameOf(as)).toEqual([]); // not hidden-from: nobody active reads it since C3 left; K1's engineer read it in the setup
  });

  it("has no invitation, and its withdrawn row is as the withdrawal left it", async () => {
    // C3's Authorized Person's pending invitations hold none on this Project (RP-1261-1's Annex rounds are all answered).
    expect(await pending(c3)).toEqual([]); // not hidden-from: nothing was sent to hide
    expect(await row(old.c3)).toEqual(before.get(old.c3));
  });
});
