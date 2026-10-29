// Seam 2 for a Project's Checklist Templates and the copy a WIR makes of the one it picks
// (RP-651, INSP-3; spec RP-649; visibility.md V3, V20, scenarios RP-651-1 and RP-651-2), as
// the app role.
//
// RP-651-1: a Project's Checklist Templates and their Versions are read by every Project
// Member of every Participant, never by another Project's, and written only by its Project
// Admins, through app.create_checklist_template, app.edit_checklist_template and
// app.retire_checklist_template: anyone else is told 'not_found'. The app role reads no one
// who wrote or retired one, nor when, and writes no row itself; a Version never changes.
//
// RP-651-2: the copy on a WIR (work_item_checklist) is read by whoever sees the WIR, and by
// nobody else: not another Contractor, not another Project. Only the Member who may save the
// WIR's answers makes it follow the answer (app.sync_work_item_checklists); after the first
// Submit it is fixed.
//
// The WIR here is a test-only Type on the WIR's Workflow whose Form is the WIR Form document
// itself (apps/admin/forms/WIR.json), so this suite needs no `pnpm defaults:publish`.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "WIRCT";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const items = JSON.stringify([{ key: "formwork", text: { en: "Formwork tight", ar: "القوالب محكمة" }, answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" }]);
const name = (en: string) => JSON.stringify({ en, ar: en });

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
let c1: Company; // Contractor: raises the WIR, and is the Project Admin.
let k1: Company; // Consultant: inspects.
let c2: Company; // A second Contractor on the Project.
let other: Company; // Another Project's Project Admin.
let k1Engineer = ""; // A K1 Project Member who is no Project Admin.
let c1Engineer = ""; // A C1 Project Member who is no Project Admin.
let projectId = "";
let otherProjectId = "";
let civil = "";
let buildingA = "";
let template = "";
let wir = "";

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

async function company(engineer: string, legal: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: legal, ar: legal }),
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

const create = (as: string, project: string, trade: string, en = "Concrete pour") =>
  call<{ outcome: string; template_id: string | null }>(
    as,
    sql`select outcome, template_id from app.create_checklist_template(${project}::uuid, ${name(en)}::jsonb, ${trade}::uuid, ${items}::jsonb, now())`,
  ).then((rows) => rows[0]!);
const edit = (as: string, id: string, en: string) =>
  outcome(as, sql`select outcome from app.edit_checklist_template(${id}::uuid, ${name(en)}::jsonb, ${civil}::uuid, ${items}::jsonb, now())`);
const retire = (as: string, id: string) => outcome(as, sql`select app.retire_checklist_template(${id}::uuid, now()) as outcome`);
const templatesAs = (as: string) =>
  call<{ id: string; project_id: string; version_no: number; status: string }>(as, sql`select id, project_id, version_no, status from checklist_template order by id`);
const versionsAs = (as: string) =>
  call<{ checklist_template_id: string; version_no: number }>(
    as,
    sql`select checklist_template_id, version_no from checklist_template_version order by checklist_template_id, version_no`,
  );
const versionId = (no: number) =>
  migrator.query("select id from checklist_template_version where checklist_template_id = $1 and version_no = $2", [template, no]).then((r) => r.rows[0].id as string);
const copiesAs = (as: string) => call<{ work_item_id: string; field_key: string }>(as, sql`select work_item_id, field_key from work_item_checklist`);
const sync = (as: string, item = wir) => outcome(as, sql`select app.sync_work_item_checklists(${item}::uuid, now()) as outcome`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  other = await company(engineer, "OT");
  k1Engineer = await member(k1.id, "k1-engineer");
  c1Engineer = await member(c1.id, "c1-engineer");
  projectId = await project(c1.ap, "CTS");
  otherProjectId = await project(other.ap, "CTO");

  const c1Participant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  const k1Participant = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  const c2Participant = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const value = async (kind: string, code: string, project = projectId, as = c1.ap) =>
    (
      await call<{ value_id: string }>(
        as,
        sql`select value_id from app.add_dimension_value(${project}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  civil = await value("trade", "CV");
  buildingA = await value("location", "BA");
  await call(k1.ap, sql<object>`select app.add_project_member(${k1Participant}::uuid, ${k1.ap}::uuid, now())`);
  await call(k1.ap, sql<object>`select app.add_project_member(${k1Participant}::uuid, ${k1Engineer}::uuid, now())`);
  await call(c1.ap, sql<object>`select app.add_project_member(${c1Participant}::uuid, ${c1Engineer}::uuid, now())`);
  await call(c2.ap, sql<object>`select app.add_project_member(${c2Participant}::uuid, ${c2.ap}::uuid, now())`);
  for (const [co, p, who] of [
    [c1, c1Participant, c1.ap],
    [k1, k1Participant, k1.ap],
    [k1, k1Participant, k1Engineer],
    [c1, c1Participant, c1Engineer],
    [c2, c2Participant, c2.ap],
  ] as const) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${who}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }

  const created = await create(c1.ap, projectId, civil);
  expect(created.outcome).toBe("created");
  template = created.template_id!;
  // Another Project's own template, which nobody here reads.
  expect((await create(other.ap, otherProjectId, await value("trade", "CV", otherProjectId, other.ap), "Elsewhere")).outcome).toBe("created");

  const [item] = await call<{ outcome: string; work_item_id: string }>(
    c1.ap,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Slab pour', app.latest_form_version(${TYPE}), '{}'::jsonb, ${civil}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(item!.outcome).toBe("created");
  wir = item!.work_item_id;
  // The pick, as app.save_work_item_answers stores it; then the copy follows it.
  await migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify({ checklist_template: await versionId(1) }), wir]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-651-1: a Project's Checklist Templates", () => {
  it("are read, with their Versions, by every Project Member of every Participant, and only their Project's", async () => {
    for (const as of [c1.ap, c1Engineer, k1.ap, k1Engineer, c2.ap]) {
      expect((await templatesAs(as)).map((t) => [t.id, t.project_id]), as).toEqual([[template, projectId]]);
      expect(await versionsAs(as), as).toEqual([{ checklist_template_id: template, version_no: 1 }]);
    }
    expect((await templatesAs(other.ap)).map((t) => t.project_id)).toEqual([otherProjectId]);
  });

  it("name no one who wrote or retired one, nor when, and the app role writes no row itself", async () => {
    for (const column of ["created_by_member_id", "created_at", "retired_by_member_id", "retired_at"]) {
      await expect(call(c1.ap, sql<object>`select ${sql.ref(column)} from checklist_template`)).rejects.toThrow(/permission denied/);
    }
    for (const column of ["created_by_member_id", "created_at"]) {
      await expect(call(c1.ap, sql<object>`select ${sql.ref(column)} from checklist_template_version`)).rejects.toThrow(/permission denied/);
    }
    await expect(call(c1.ap, sql<object>`update checklist_template set status = 'retired' where id = ${template}::uuid`)).rejects.toThrow(/permission denied/);
    await expect(call(c1.ap, sql<object>`delete from checklist_template_version where checklist_template_id = ${template}::uuid`)).rejects.toThrow(/permission denied/);
    await expect(call(c1.ap, sql<object>`insert into work_item_checklist (work_item_id, field_key, checklist_template_version_id, name, items) values (${wir}::uuid, 'x', ${await versionId(1)}::uuid, ${name("x")}::jsonb, '[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    // Not even the owner changes a Version: the items that copied it say which it was.
    await expect(migrator.query("update checklist_template_version set items = '[]' where checklist_template_id = $1", [template])).rejects.toThrow(/append-only/);
  });

  it("are written by the Project's Project Admins only: anyone else is told 'not_found', and nothing changes", async () => {
    for (const as of [c1Engineer, k1.ap, k1Engineer, c2.ap, other.ap]) {
      expect((await create(as, projectId, civil)).outcome, as).toBe("not_found");
      expect(await edit(as, template, "Changed"), as).toBe("not_found");
      expect(await retire(as, template), as).toBe("not_found");
    }
    expect(await edit(c1.ap, randomUUID(), "Made up")).toBe("not_found");
    expect((await create(c1.ap, projectId, buildingA)).outcome).toBe("trade_not_found");
    expect(await templatesAs(k1.ap)).toEqual([{ id: template, project_id: projectId, version_no: 1, status: "active" }]);
  });
});

describe("RP-651-2: the copy on a WIR", () => {
  it("is made by the Member who may save the WIR's answers, and refused to anyone else", async () => {
    for (const as of [k1.ap, c2.ap, other.ap]) expect(await sync(as), as).toBe("not_editable");
    expect(await copiesAs(c1.ap)).toEqual([]);
    expect(await sync(c1.ap)).toBe("synced");
    expect(await copiesAs(c1.ap)).toEqual([{ work_item_id: wir, field_key: "checklist_template" }]);
    // A Draft: nobody outside C1 reads it, nor its copy.
    for (const as of [k1.ap, k1Engineer, c2.ap, other.ap]) expect(await copiesAs(as), as).toEqual([]);
  });

  it("stays as copied when the template gets a new Version", async () => {
    expect(await edit(c1.ap, template, "Concrete pour, edited")).toBe("edited");
    expect(await sync(c1.ap)).toBe("synced");
    const [copy] = await call<{ checklist_template_version_id: string; name: { en: string } }>(
      c1.ap,
      sql`select checklist_template_version_id, name from work_item_checklist where work_item_id = ${wir}::uuid`,
    );
    expect(copy).toEqual({ checklist_template_version_id: await versionId(1), name: { en: "Concrete pour", ar: "Concrete pour" } });
  });

  it("takes, for a new copy, only the latest Version of an active template: a superseded or retired one is refused", async () => {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      c1.ap,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Column pour', app.latest_form_version(${TYPE}), '{}'::jsonb, ${civil}::uuid, ${buildingA}::uuid, now())`,
    );
    const pick = async (version: string) => {
      await migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify({ checklist_template: version }), draft!.work_item_id]);
      return sync(c1.ap, draft!.work_item_id);
    };
    expect(await pick(await versionId(1))).toBe("template_not_found");
    expect(await pick(await versionId(2))).toBe("synced");
    const retiring = (await create(c1.ap, projectId, civil, "Kerbs")).template_id!;
    expect(await retire(c1.ap, retiring)).toBe("retired");
    const retired = (await migrator.query("select id from checklist_template_version where checklist_template_id = $1", [retiring])).rows[0].id as string;
    expect(await pick(retired)).toBe("template_not_found");
  });

  it("is read by whoever sees the WIR once Submitted, never by another Contractor or another Project; and is fixed", async () => {
    await migrator.query(
      `update work_item w set document_number = 'CTS-WIR-0001', submitted_at = now(), participant_entered_step_id = (
         select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and not app.is_draft_step(s.id) order by s.id limit 1)
       where w.id = $1`,
      [wir],
    );
    const k1Participant = (await migrator.query("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id])).rows[0].id as string;
    await migrator.query("insert into work_item_access (work_item_id, project_id, participant_id, since, reason) values ($1, $2, $3, now(), 'handling')", [wir, projectId, k1Participant]);
    for (const as of [c1.ap, k1.ap, k1Engineer]) expect((await copiesAs(as)).filter((c) => c.work_item_id === wir), as).toEqual([{ work_item_id: wir, field_key: "checklist_template" }]);
    for (const as of [c2.ap, other.ap]) expect(await copiesAs(as), as).toEqual([]);
    // Fixed: a changed pick, after the first Submit, is refused whoever could save.
    await migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify({ checklist_template: await versionId(2) }), wir]);
    expect(await sync(c1.ap)).toBe("not_editable");
  });
});

// RP-1082 (epic review RP-676; CODING_STANDARDS "Row-level security on every Project table, keyed by project_id").
describe("the copy on a WIR is keyed by its Project", () => {
  it("carries its item's Project, which the database holds it to", async () => {
    const { rows } = await migrator.query("select c.project_id, w.project_id as item_project_id from work_item_checklist c join work_item w on w.id = c.work_item_id");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.project_id).toBe(row.item_project_id);
    // Another Project's id is refused: the composite key to work_item (id, project_id).
    const otherProjectId = (await migrator.query("select id from project where id <> $1 limit 1", [projectId])).rows[0].id as string;
    await expect(migrator.query("update work_item_checklist set project_id = $1 where work_item_id = $2", [otherProjectId, wir])).rejects.toThrow(/foreign key/);
  });

  it("is read only on a Project the reader is on, and the item they see", async () => {
    const { rows } = await migrator.query(
      "select qual from pg_policies where tablename = 'work_item_checklist' and policyname = 'member_reads_work_item_checklists'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toMatch(/project_id IN \( SELECT app\.current_project_ids/);
    expect(rows[0].qual).toMatch(/app\.sees_work_item\(work_item_id\)/);
  });
});

describe("the definer helpers no app role runs (RP-1082)", () => {
  it("run as their caller: each is security invoker, and the app role may not run it", async () => {
    const { rows } = await migrator.query(
      `select p.oid::regprocedure::text as fn, p.prosecdef as definer, has_function_privilege('rabaed_app', p.oid, 'EXECUTE') as app_runs
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('reply_checklist_item', 'reply_files_waiting', 'is_project_trade', 'reply_field_refusal')
       order by 1`,
    );
    expect(rows).toEqual([
      { fn: "app.is_project_trade(uuid,uuid)", definer: false, app_runs: false },
      { fn: "app.reply_checklist_item(uuid,jsonb,text)", definer: false, app_runs: false },
      { fn: "app.reply_field_refusal(uuid,text,text,text,uuid)", definer: false, app_runs: false },
      { fn: "app.reply_files_waiting(uuid,text,text,uuid)", definer: false, app_runs: false },
    ]);
  });
});
