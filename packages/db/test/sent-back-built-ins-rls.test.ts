// Seam 2 for an item's Trade, Location and Scopes while it is Sent Back to its raiser (RP-582;
// ADR 0021, ADR 0014; visibility.md V12, V19, layer 4, scenarios RP-582-1 and RP-582-2), as the
// app role. At a Step that says "Edit the Form" (RP-580) C1 moves the item from Tower 1 to
// Building A and changes its Scope: until C1 Submits it again, everyone outside C1 reads it as it
// was at the Send Back, whatever they query (app.sees_work_item, the tables themselves, the
// views work_item_dimension_value_seen and work_item_scope_seen, app.search_work_items); C1 reads
// it as it is now. At the Submit the new values apply to everyone (V12).
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls, withSignature } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "SBBRL";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the item and moves it while it is Sent Back.
let k1: Company; // Consultant: Sends it Back.
let ow: Company; // Owner (oversight): its two engineers each cover one Location.
let c1Pm = "";
let owTower1 = ""; // Covers Tower 1 only.
let owBuildingA = ""; // Covers Building A only.
let projectId = "";
let participant: { c1: string; k1: string; ow: string };
let electrical = "";
let tower1 = "";
let buildingA = "";
let lighting = "";
let power = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Member's insert, with an active Signature (RP-85: no Signature, no Transition). */
const signedMember = async (text: string, values: unknown[]) => withSignature((t, v) => migrator.query(t, v), await one(text, values));

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return signedMember(
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

/** A test-only Type on the test Workflow, its Draft Step opening the Form after a Send Back (RP-580). */
async function addType() {
  const schema = {
    sections: [
      {
        key: "report",
        title: { en: "Report", ar: "التقرير" },
        fields: [
          { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
          { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
        ],
      },
    ],
  };
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { afterSendBack: { draft: "edit_form" } });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Sent Back built-ins", "ar": "حقول الإرجاع"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Sent Back built-ins", "ar": "حقول الإرجاع"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const save = (as: string, id: string, location: string, scopes: string[]) =>
  outcome(
    as,
    sql`select app.save_work_item_answers(${id}::uuid, '{"model": "Daily report"}'::jsonb, ${electrical}::uuid, ${location}::uuid,
      ${scopes}::uuid[], now()) as outcome`,
  );

/** What `as` reads of item `id`'s built-ins, from every channel the app role has. */
const reads = async (as: string, id: string) => ({
  sees: (await call<{ sees: boolean }>(as, sql`select app.sees_work_item(${id}::uuid) as sees`))[0]!.sees,
  valueRows: (await call<{ v: string }>(as, sql`select dimension_value_id as v from work_item_dimension_value where work_item_id = ${id}`))
    .map((r) => r.v)
    .sort(),
  values: (await call<{ v: string }>(as, sql`select dimension_value_id as v from work_item_dimension_value_seen where work_item_id = ${id}`))
    .map((r) => r.v)
    .sort(),
  scopeRows: (await call<{ s: string }>(as, sql`select scope_id as s from work_item_scope where work_item_id = ${id}`)).map((r) => r.s),
  scopes: (await call<{ s: string }>(as, sql`select scope_id as s from work_item_scope_seen where work_item_id = ${id}`)).map((r) => r.s),
  found: async (q: string) =>
    (await call<{ id: string }>(as, sql`select id from app.search_work_items(${projectId}::uuid, ${q}) as id`)).map((r) => r.id).includes(id),
});

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  c1Pm = await member(c1.id, "pm");
  owTower1 = ow.member;
  owBuildingA = await member(ow.id, "engineer-a");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWB', 'contractor')`,
  );
  projectId = created!.project_id;
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
  };
  const value = async (kind: string, code: string, name: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: name, ar: name })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL", "Electrical");
  tower1 = await value("location", "T1", "Tower One");
  buildingA = await value("location", "BA", "Building Alpha");
  const scope = async (name: string) =>
    (await call<{ scope_id: string }>(c1.ap, sql`select scope_id from app.add_scope(${projectId}::uuid, ${electrical}::uuid, null, ${JSON.stringify({ en: name, ar: name })}::jsonb)`))[0]!
      .scope_id;
  lighting = await scope("Lighting");
  power = await scope("Power");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  // Each person's own Visibility: everything, but the Owner's engineers one Location each.
  const people: [Company, string, string, string[], string | null][] = [
    [c1, participant.c1, c1.member, ["engineer"], null],
    [c1, participant.c1, c1Pm, ["project_manager"], null],
    [k1, participant.k1, k1.member, ["engineer"], null],
    [ow, participant.ow, owTower1, ["representative"], tower1],
    [ow, participant.ow, owBuildingA, ["representative"], buildingA],
  ];
  for (const [co, p, m, positions, onlyLocation] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, 'trade', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    const location = onlyLocation
      ? sql<{ outcome: string }>`select app.set_member_visibility(${p}::uuid, ${m}::uuid, 'location', false, ${[onlyLocation]}::uuid[], now()) as outcome`
      : sql<{ outcome: string }>`select app.set_member_visibility(${p}::uuid, ${m}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`;
    expect(await outcome(co.ap, location)).toBe("set");
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("C1 moves an item Sent Back to its Draft from Tower 1 to Building A, and changes its Scope (scenarios RP-582-1, RP-582-2)", () => {
  let id = "";

  beforeAll(async () => {
    const [made] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Daily report', app.latest_form_version(${TYPE}), '{"model": "Daily report"}'::jsonb,
        ${electrical}::uuid, ${tower1}::uuid, now())`,
    );
    id = made!.work_item_id;
    expect(await save(c1.member, id, tower1, [lighting])).toBe("saved");
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await take(k1.member, id, "send_back_to_draft")).toBe("applied");
    expect(await save(c1.member, id, buildingA, [power])).toBe("saved");
  });

  it("shows C1 the item as it is now: Building A, Power", async () => {
    for (const c1Member of [c1.member, c1Pm]) {
      const r = await reads(c1Member, id);
      expect(r.sees).toBe(true);
      expect(r.valueRows).toEqual([electrical, buildingA].sort());
      expect(r.values).toEqual([electrical, buildingA].sort());
      expect(r.scopeRows).toEqual([power]);
      expect(r.scopes).toEqual([power]);
    }
  });

  it("keeps it with the Owner's Tower 1 engineer and K1 as it was: Tower 1, Lighting, found under Tower One only", async () => {
    for (const other of [owTower1, k1.member]) {
      const r = await reads(other, id);
      expect(r.sees).toBe(true);
      expect(r.values).toEqual([electrical, tower1].sort());
      expect(r.scopes).toEqual([lighting]);
      // The tables themselves never hand them the rows as they are now.
      expect(r.valueRows).not.toContain(buildingA);
      expect(r.scopeRows).not.toContain(power);
      expect(await r.found("Tower One")).toBe(true);
      expect(await r.found("Alpha")).toBe(false);
    }
  });

  it("keeps it from the Owner's Building A engineer, through every channel", async () => {
    const r = await reads(owBuildingA, id);
    expect(r).toMatchObject({ sees: false, valueRows: [], values: [], scopeRows: [], scopes: [] });
    expect(await r.found("Daily")).toBe(false);
  });

  it("finds it under Tower 1's new name once Tower 1 is renamed, as the snapshot names it", async () => {
    await migrator.query(`update dimension_value set name = '{"en": "Tower Uno", "ar": "Tower Uno"}' where id = $1`, [tower1]);
    expect(await (await reads(owTower1, id)).found("Uno")).toBe(true);
  });

  it("applies Building A and Power to everyone once C1 Submits it again (V12)", async () => {
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    const lost = await reads(owTower1, id);
    expect(lost).toMatchObject({ sees: false, values: [], scopes: [] });
    const gained = await reads(owBuildingA, id);
    expect(gained).toMatchObject({ sees: true, values: [electrical, buildingA].sort(), valueRows: [electrical, buildingA].sort(), scopes: [power] });
    expect(await gained.found("Alpha")).toBe(true);
    expect((await reads(k1.member, id)).scopes).toEqual([power]);
  });
});
