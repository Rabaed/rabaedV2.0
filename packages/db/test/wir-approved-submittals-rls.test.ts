// Seam 2 for the WIR's Approved submittals and the Project setting that makes them
// required (RP-82, INSP-2; spec RP-649; visibility.md E1, V20, scenarios RP-82-1 and
// RP-82-2), as the app role.
//
// RP-82-1: C1's WIR in Building A names under Approved submittals a MAR closed at Code
// A in Building B. K1's inspector, who covers Building A only, reads the WIR and gets
// that MAR as its Document Number and Subject only, never its id; K1's Authorized
// Person, who covers the whole Project, gets its id.
//
// RP-82-2: which link questions a Project makes required (project_required_field) is
// read by every Project Member of every Participant, never by another Project's, and
// changed only by its Project Admins, through app.set_project_required_field; the app
// role reads no one who set it, and writes no row itself. Each change is audited in
// setup_event (RP-664), which the app role does not read.
//
// The WIR here is a test-only Type on the WIR's Workflow whose Form is the WIR Form
// document itself (apps/admin/forms/WIR.json), so this suite needs no `pnpm defaults:publish`.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "WIRDB";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
let c1: Company; // Contractor: raises the WIR, and is the Project Admin.
let k1: Company; // Consultant: inspects.
let other: Company; // Another Project's Project Admin.
let inspector = ""; // K1's engineer, covering Building A only.
let projectId = "";
let otherProjectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
let wir = "";
let mar = "";
const marNumber = "WAS-MAR-01-0007";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const member = (companyId: string, who: string, creator = false) =>
  one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
    creator,
  ]);

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
  return { id, cr, ap };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** The test WIR Type: the WIR's Workflow, with the WIR Form document as its Form's one Version. */
async function addType() {
  const exists = await migrator.query("select 1 from work_item_type where owner_kind = 'rabaed' and code = $1", [TYPE]);
  if (exists.rowCount) return;
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [
    JSON.stringify({ en: "Work Inspection Request (test)", ar: "طلب معاينة أعمال (اختبار)" }),
  ]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    wirForm,
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, workflow_definition_id, outcome_kind, $3
     from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify({ en: "Work Inspection Request (test)", ar: "طلب معاينة أعمال (اختبار)" }), formId],
  );
}

async function project(as: string, code: string): Promise<string> {
  const [created] = await call<{ project_id: string }>(
    as,
    sql`select project_id from app.create_project(${JSON.stringify({ en: code, ar: code })}::jsonb, ${code}, 'contractor')`,
  );
  return created!.project_id;
}

/** As the owner: the item has left its raiser (Submitted), as a Submit would leave it, and is numbered. */
async function submit(item: string, number: string) {
  await migrator.query(
    `update work_item w set document_number = $2, submitted_at = coalesce(submitted_at, now()), participant_entered_step_id = (
       select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and not app.is_draft_step(s.id)
       order by s.id limit 1)
     where w.id = $1`,
    [item, number],
  );
}

const answers = (as: string, item: string) =>
  call<{ answers: Record<string, unknown> | null }>(as, sql`select app.work_item_answers(${item}::uuid) as answers`).then((rows) => rows[0]!.answers);

const setRequired = (as: string, project: string, type: string, required: boolean | null) =>
  outcome(as, sql`select app.set_project_required_field(${project}::uuid, ${type}, 'approved_submittals', ${required}, now()) as outcome`);
const requiredRows = (as: string) =>
  call<{ project_id: string; field_key: string }>(as, sql`select project_id, field_key from project_required_field order by project_id`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  other = await company(engineer, "OT");
  inspector = await member(k1.id, "inspector");
  projectId = await project(c1.ap, "WAS");
  otherProjectId = await project(other.ap, "WAO");

  const c1Participant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  const k1Participant = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  buildingB = await value("location", "BB");
  await call(k1.ap, sql<object>`select app.add_project_member(${k1Participant}::uuid, ${k1.ap}::uuid, now())`);
  for (const [co, p] of [
    [c1, c1Participant],
    [k1, k1Participant],
  ] as const) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${co.ap}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  await call(k1.ap, sql<object>`select app.add_project_member(${k1Participant}::uuid, ${inspector}::uuid, now())`);
  expect(await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${inspector}::uuid, 'trade', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  expect(
    await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${inspector}::uuid, 'location', false, ${[buildingA]}::uuid[], now()) as outcome`),
  ).toBe("set");

  const item = async (type: string, title: string, location: string) => {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.ap,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), '{}'::jsonb,
        ${electrical}::uuid, ${location}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  };
  // A MAR in Building B, closed at Code A, as the Consultant's Code leaves it.
  mar = await item("MAR", "Approved cable trays", buildingB);
  await submit(mar, marNumber);
  await migrator.query("update work_item set outcome = 'A', closed_at = now() where id = $1", [mar]);
  // C1's WIR in Building A, naming it under Approved submittals, Submitted to K1.
  wir = await item(TYPE, "Cable trays, level 3", buildingA);
  await migrator.query("update work_item set data = $1 where id = $2", [
    JSON.stringify({ description: "Trays ready", requested_for: "2026-11-02T05:30:00.000Z", approved_submittals: [mar] }),
    wir,
  ]);
  await submit(wir, "WAS-WIR-01-0001");
  // K1 handles both, as the Submit and the Code leave them.
  for (const item of [wir, mar]) {
    await migrator.query(
      "insert into work_item_access (work_item_id, project_id, participant_id, since, reason) values ($1, $2, $3, now(), 'handling')",
      [item, projectId, k1Participant],
    );
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-82-1: an inspector reads an Approved submittal they can't see as its Document Number and Subject (E1)", () => {
  it("gives K1's inspector, covering Building A only, the WIR with the MAR as its number and Subject, never its id", async () => {
    const read = await answers(inspector, wir);
    expect(read).toMatchObject({
      requested_for: "2026-11-02T05:30:00.000Z",
      approved_submittals: [{ document_number: marNumber, subject: "Approved cable trays" }],
    });
    expect(JSON.stringify(read)).not.toContain(mar);
    // Nor can they open the MAR itself, which K1's Authorized Person reads by id (RP-1095).
    await expectHiddenFrom({
      read: (as: string) => call<{ id: string }>(as, sql`select id from work_item where id = ${mar}::uuid`),
      target: mar,
      seenBy: k1.ap,
      hiddenFrom: inspector,
      label: "the MAR",
    });
  });

  it("gives a reader who sees the MAR its id", async () => {
    expect(await answers(k1.ap, wir)).toMatchObject({ approved_submittals: [mar] });
  });
});

describe("RP-82-2: which link questions a Project makes required", () => {
  beforeAll(async () => {
    expect(await setRequired(c1.ap, projectId, TYPE, true)).toBe("set");
    expect(await setRequired(other.ap, otherProjectId, TYPE, true)).toBe("set");
  });

  it("is read by every Project Member of every Participant, and only their Project's", async () => {
    for (const as of [c1.ap, k1.ap, inspector]) {
      expect(await requiredRows(as), as).toEqual([{ project_id: projectId, field_key: "approved_submittals" }]);
    }
    expect(await requiredRows(other.ap)).toEqual([{ project_id: otherProjectId, field_key: "approved_submittals" }]);
  });

  it("names no one who set it, and the app role writes no row itself", async () => {
    await expect(call(c1.ap, sql<object>`select set_by_member_id from project_required_field`)).rejects.toThrow(/permission denied/);
    await expect(call(c1.ap, sql<object>`select set_at from project_required_field`)).rejects.toThrow(/permission denied/);
    const typeId = (await migrator.query("select id from work_item_type where code = $1", [TYPE])).rows[0].id as string;
    await expect(
      call(c1.ap, sql<object>`insert into project_required_field (project_id, work_item_type_id, field_key, set_by_member_id) values (${projectId}::uuid, ${typeId}::uuid, 'x', ${c1.ap}::uuid)`),
    ).rejects.toThrow(/permission denied/);
    await expect(call(c1.ap, sql<object>`delete from project_required_field where project_id = ${projectId}::uuid`)).rejects.toThrow(/permission denied/);
  });

  it("is changed by the Project's Project Admins only: anyone else is told 'not_found', and nothing changes", async () => {
    for (const as of [k1.ap, inspector, other.ap]) expect(await setRequired(as, projectId, TYPE, false), as).toBe("not_found");
    expect(await setRequired(c1.ap, randomUUID(), TYPE, true)).toBe("not_found");
    expect(await requiredRows(c1.ap)).toEqual([{ project_id: projectId, field_key: "approved_submittals" }]);
    expect(await setRequired(c1.ap, projectId, "ZZZ", true)).toBe("type_not_found");
  });

  it("turned off, is gone; turned on again, is back; on a Closed Project, refused", async () => {
    expect(await setRequired(c1.ap, projectId, TYPE, false)).toBe("set");
    expect(await requiredRows(k1.ap)).toEqual([]);
    expect(await setRequired(c1.ap, projectId, TYPE, true)).toBe("set");
    expect(await setRequired(c1.ap, projectId, TYPE, true)).toBe("set");
    expect(await requiredRows(k1.ap)).toEqual([{ project_id: projectId, field_key: "approved_submittals" }]);
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [otherProjectId]);
    expect(await setRequired(other.ap, otherProjectId, TYPE, false)).toBe("project_closed");
  });

  // RP-664 (RP-1082 item 5): each change is audited in setup_event, kind project_setting; a repeat or a refusal writes nothing.
  it("writes one setup_event per change, with from and to, and none for a repeat or a refusal", async () => {
    const events = async (project: string) =>
      (
        await migrator.query<{ kind: string; type: string; actor_member_id: string; company_id: string | null; payload: unknown }>(
          "select kind, type, actor_member_id, company_id, payload from setup_event where project_id = $1 and type = 'required_field_changed' order by created_at, id",
          [project],
        )
      ).rows;
    const typeId = (await migrator.query("select id from work_item_type where code = $1", [TYPE])).rows[0].id as string;
    const change = (from: boolean, to: boolean) => ({
      kind: "project_setting",
      type: "required_field_changed",
      actor_member_id: c1.ap,
      company_id: null,
      payload: { work_item_type_id: typeId, field_key: "approved_submittals", from, to },
    });
    // Start from off, whatever the tests before left.
    await setRequired(c1.ap, projectId, TYPE, false);
    const before = (await events(projectId)).length;

    expect(await setRequired(c1.ap, projectId, TYPE, true)).toBe("set");
    expect((await events(projectId)).slice(before)).toEqual([change(false, true)]);
    // The same value again, and refusals, write nothing.
    expect(await setRequired(c1.ap, projectId, TYPE, true)).toBe("set");
    expect(await setRequired(k1.ap, projectId, TYPE, false)).toBe("not_found");
    expect(await setRequired(c1.ap, projectId, "ZZZ", false)).toBe("type_not_found");
    expect(await setRequired(c1.ap, projectId, TYPE, null)).toBe("not_found");
    expect((await events(projectId)).slice(before)).toHaveLength(1);
    expect(await requiredRows(k1.ap)).toEqual([{ project_id: projectId, field_key: "approved_submittals" }]);

    expect(await setRequired(c1.ap, projectId, TYPE, false)).toBe("set");
    expect(await setRequired(c1.ap, projectId, TYPE, false)).toBe("set");
    expect((await events(projectId)).slice(before)).toEqual([change(false, true), change(true, false)]);

    // A Closed Project's refusal writes nothing.
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [otherProjectId]);
    const otherBefore = (await events(otherProjectId)).length;
    expect(await setRequired(other.ap, otherProjectId, TYPE, false)).toBe("project_closed");
    expect(await events(otherProjectId)).toHaveLength(otherBefore);

    // Read by nobody through the app role, the Project Admin who made the change included (RP-450-1).
    await expect(call(c1.ap, sql<object>`select 1 from setup_event where project_id = ${projectId}::uuid`)).rejects.toThrow(/permission denied/);
    await setRequired(c1.ap, projectId, TYPE, true);
  });
});
