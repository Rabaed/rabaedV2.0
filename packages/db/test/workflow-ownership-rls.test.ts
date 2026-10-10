// Seam 2 for Workflow ownership and the Project binding (RP-426; ADR 0016;
// workflow-engine.md §1 "Ownership and binding"; visibility.md V20 and scenarios
// RP-426-1 and RP-426-2), as the app role and the migrator:
// - a Workflow definition belongs to Rabaed, a Project or a Company's Library;
// - a Project binds a Work Item Type to one of its own Workflows (or a Rabaed
//   Default), optionally only for one raising Participant, and app.create_work_item
//   pins the latest published Version of the binding that applies: the raiser's
//   exception first, then the Project's, then the Type's Rabaed Default;
// - every Participant on the Project reads the Project's Workflows whole, other
//   Companies' internal Steps included, but nothing of what happened on an item at
//   them (V5, V14); a Library is its Company's alone (V18); a draft Version is
//   read by nobody through the app role.
import { randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls, type TestWorkflowOptions } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "WFOWN";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor; its Authorized Person created "Tower" and is its Project Admin.
let c2: Company; // Another Contractor on "Tower".
let k1: Company; // The Consultant on "Tower"; keeps a Workflow in its Library.
let x: Company; // On another Project only.
let c1Pm = "";
let k1Manager = "";
let projectId = "";
let otherProjectId = "";
let participant: { c1: string; c2: string; k1: string };
let electrical = "";
let buildingA = "";
let typeId = "";
let rabaedDefault = ""; // The Type's Rabaed Default Workflow.
let projectWorkflow = ""; // "Tower"'s own Workflow for the Type.
let exceptionWorkflow = ""; // "Tower"'s Workflow for C2's items of the Type.
let library = ""; // A Workflow in K1's Library.
let otherProjectWorkflow = ""; // The other Project's own Workflow.

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

const call = <T extends object = Record<string, unknown>>(as: string, query: RawBuilder<T> | RawBuilder<unknown>) =>
  withMember(app, as, (trx) => (query as RawBuilder<T>).execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

const workflow = (name: string, options: TestWorkflowOptions = {}) =>
  addTestWorkflow((text) => migrator.query(text), { name: { en: name, ar: name }, ...options });

/** A test-only Rabaed Type on its own Rabaed Default (the test Send Back Workflow), with a small Form. */
async function addType(): Promise<{ typeId: string; workflowId: string }> {
  const existing = await migrator.query("select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = $1", [TYPE]);
  if (existing.rows[0]) return { typeId: existing.rows[0].id, workflowId: existing.rows[0].workflow_definition_id };
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
  const workflowId = await workflow("Ownership default (test)");
  const form = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [
    JSON.stringify({ en: "Ownership", ar: "الملكية" }),
  ]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2)", [
    form,
    JSON.stringify(schema),
  ]);
  const id = await one(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
    [TYPE, JSON.stringify({ en: "Ownership", ar: "الملكية" }), workflowId, form],
  );
  return { typeId: id, workflowId };
}

const bind = (definitionId: string, raisingParticipantId: string | null = null, project = projectId) =>
  migrator.query(
    "insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id) values ($1, $2, $3, $4)",
    [project, typeId, raisingParticipantId, definitionId],
  );

/** A Draft of the test Type raised by `as`, and the Workflow definition and Version number it is pinned to. */
async function raise(as: string): Promise<{ id: string; definition: string; versionNo: number }> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), '{"model": "CT-1"}'::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const { rows } = await migrator.query(
    `select v.workflow_definition_id as definition, v.version_no from work_item w join workflow_version v on v.id = w.workflow_version_id
     where w.id = $1`,
    [created!.work_item_id],
  );
  return { id: created!.work_item_id, definition: rows[0].definition, versionNo: rows[0].version_no };
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** The Workflow definitions `as` reads, of those named. */
const definitionsRead = async (as: string, ids: string[]) =>
  (await call<{ id: string }>(as, sql`select id from workflow_definition where id = any(${ids}::uuid[])`)).map((r) => r.id).sort();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  ({ typeId, workflowId: rabaedDefault } = await addType());
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  c2 = await company(engineer, "C2");
  k1 = await company(engineer, "K1");
  x = await company(engineer, "X");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'WFO', 'contractor')`,
  );
  projectId = created!.project_id;
  const [other] = await call<{ project_id: string }>(
    x.ap,
    sql`select project_id from app.create_project('{"en": "Elsewhere", "ar": "مكان آخر"}'::jsonb, 'ELS', 'contractor')`,
  );
  otherProjectId = other!.project_id;
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
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
    [c2, participant.c2, c2.member, ["engineer"]],
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

  projectWorkflow = await workflow("Tower's own (test)", { owner: { kind: "project", projectId } });
  exceptionWorkflow = await workflow("C2's items (test)", { owner: { kind: "project", projectId } });
  library = await workflow("K1's Library (test)", { owner: { kind: "company", companyId: k1.id } });
  otherProjectWorkflow = await workflow("Elsewhere's own (test)", { owner: { kind: "project", projectId: otherProjectId } });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Workflow definition's owner", () => {
  it("is Rabaed, a Project or a Company, with exactly the owner's id", async () => {
    const insert = (kind: string, project: string | null, company: string | null) =>
      migrator.query("insert into workflow_definition (owner_kind, project_id, company_id, name) values ($1, $2, $3, $4)", [
        kind,
        project,
        company,
        JSON.stringify({ en: "Owner", ar: "المالك" }),
      ]);
    for (const [kind, project, company] of [
      ["company", null, null],
      ["company", projectId, k1.id],
      ["project", null, k1.id],
      ["rabaed", null, k1.id],
      ["library", null, k1.id],
    ] as const) {
      await expect(insert(kind, project, company), `${kind} ${project} ${company}`).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("is never written by the app role", async () => {
    await expect(
      call(k1.ap, sql`insert into workflow_definition (owner_kind, company_id, name) values ('company', ${k1.id}::uuid, '{"en": "M", "ar": "م"}')`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(call(c1.ap, sql`delete from workflow_binding`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("binding a Type on a Project", () => {
  it("takes one of the Project's own Workflows or a Rabaed Default, never another Project's or a Library's", async () => {
    await expect(bind(otherProjectWorkflow)).rejects.toMatchObject({ code: "23514" });
    await expect(bind(library)).rejects.toMatchObject({ code: "23514" });
  });

  it("takes only a Workflow with a published Version", async () => {
    const unpublished = await workflow("Unpublished (test)", { owner: { kind: "project", projectId }, publish: false });
    await expect(bind(unpublished)).rejects.toMatchObject({ code: "23514" });
  });

  it("takes an exception only for a Participant on that Project", async () => {
    const elsewhere = (await migrator.query("select id from participant where project_id = $1", [otherProjectId])).rows[0].id as string;
    await expect(bind(projectWorkflow, elsewhere)).rejects.toMatchObject({ code: "23514" });
  });
});

// In order: each step binds more, and earlier items keep the Version they started on.
describe("a new item's Workflow", () => {
  let first: Awaited<ReturnType<typeof raise>>;
  let onProjectV1: Awaited<ReturnType<typeof raise>>;

  it("is the Type's Rabaed Default while the Project binds nothing", async () => {
    first = await raise(c1.member);
    expect(first).toMatchObject({ definition: rabaedDefault, versionNo: 1 });
  });

  it("is the Project's Workflow once bound, for every raiser, and items already created keep theirs", async () => {
    await bind(projectWorkflow);
    onProjectV1 = await raise(c1.member);
    expect(onProjectV1).toMatchObject({ definition: projectWorkflow, versionNo: 1 });
    expect(await raise(c2.member)).toMatchObject({ definition: projectWorkflow, versionNo: 1 });
    // A Draft on the Project's own Workflow is a Draft all the same: its raiser's alone (V1).
    const [canSave] = await call<{ ok: boolean }>(c1.member, sql`select app.can_save_answers(${onProjectV1.id}::uuid) as ok`);
    expect(canSave!.ok).toBe(true);
    for (const as of [k1.member, c2.member]) {
      expect(await call(as, sql`select id from work_item where id = ${onProjectV1.id}::uuid`), as).toEqual([]);
    }
    expect((await migrator.query("select workflow_version_id from work_item where id = $1", [first.id])).rows[0].workflow_version_id).toBe(
      (await migrator.query("select id from workflow_version where workflow_definition_id = $1", [rabaedDefault])).rows[0].id,
    );
  });

  it("is that Workflow's latest published Version, never a draft", async () => {
    await workflow("", { version: { definitionId: projectWorkflow, no: 2 } });
    await workflow("", { version: { definitionId: projectWorkflow, no: 3 }, publish: false });
    expect(await raise(c1.member)).toMatchObject({ definition: projectWorkflow, versionNo: 2 });
    const { rows } = await migrator.query(
      "select v.version_no from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = $1",
      [onProjectV1.id],
    );
    expect(rows[0].version_no).toBe(1);
  });

  it("is the raiser's exception first: C2's items take theirs, C1's the Project's", async () => {
    await bind(exceptionWorkflow, participant.c2);
    expect(await raise(c2.member)).toMatchObject({ definition: exceptionWorkflow, versionNo: 1 });
    expect(await raise(c1.member)).toMatchObject({ definition: projectWorkflow, versionNo: 2 });
  });

  it("has one default binding per Type and one exception per raising Participant", async () => {
    await expect(bind(exceptionWorkflow)).rejects.toMatchObject({ code: "23505" });
    await expect(bind(projectWorkflow, participant.c2)).rejects.toMatchObject({ code: "23505" });
  });
});

describe("reading Workflows (V20, V18)", () => {
  const named = () => [rabaedDefault, projectWorkflow, exceptionWorkflow, library, otherProjectWorkflow];

  it("every Participant on the Project reads its Workflows and the Rabaed Defaults; nothing of another Project's or a Library", async () => {
    for (const as of [c1.member, c2.member, k1.member]) {
      expect(await definitionsRead(as, named()), as).toEqual(
        as === k1.member ? [rabaedDefault, projectWorkflow, exceptionWorkflow, library].sort() : [rabaedDefault, projectWorkflow, exceptionWorkflow].sort(),
      );
    }
  });

  it("a Library is read by its own Company only, on a Project or not", async () => {
    expect(await definitionsRead(k1.ap, [library])).toEqual([library]);
    for (const as of [c1.member, c1.ap, c2.member, x.member]) expect(await definitionsRead(as, [library]), as).toEqual([]);
  });

  it("a Company on no shared Project reads the Rabaed Defaults only, and its own Project's", async () => {
    expect(await definitionsRead(x.ap, named())).toEqual([rabaedDefault, otherProjectWorkflow].sort());
    expect(await call(x.ap, sql`select id from workflow_binding where project_id = ${projectId}::uuid`)).toEqual([]);
  });

  it("only published Versions are read", async () => {
    const versions = await call<{ version_no: number }>(
      c2.member,
      sql`select version_no from workflow_version where workflow_definition_id = ${projectWorkflow}::uuid order by version_no`,
    );
    expect(versions).toEqual([{ version_no: 1 }, { version_no: 2 }]);
  });

  it("the Project's bindings are read by its Members; an exception by its raising Participant and the Project Admins only (scenario RP-426-2)", async () => {
    const bindings = async (as: string) =>
      (
        await call<{ raising_participant_id: string | null }>(
          as,
          sql`select raising_participant_id from workflow_binding where project_id = ${projectId}::uuid order by raising_participant_id nulls first`,
        )
      ).map((r) => r.raising_participant_id);
    expect(await bindings(c1.ap)).toEqual([null, participant.c2]);
    expect(await bindings(c2.member)).toEqual([null, participant.c2]);
    expect(await bindings(c1.member)).toEqual([null]);
    expect(await bindings(k1.member)).toEqual([null]);
  });
});

describe("scenario RP-426-1: the map is everyone's, an item's internal moves are not", () => {
  it("C2 reads the Project's Workflow whole, K1's internal Steps and Return included, but nothing of K1's internal move on an item", async () => {
    const [v2] = await call<{ id: string }>(
      c2.member,
      sql`select id from workflow_version where workflow_definition_id = ${projectWorkflow}::uuid and version_no = 2`,
    );
    const steps = await call<{ key: string }>(c2.member, sql`select key from workflow_step where workflow_version_id = ${v2!.id}::uuid order by key`);
    expect(steps.map((s) => s.key)).toContain("consultant_approval");
    const transitions = await call<{ key: string }>(c2.member, sql`select key from workflow_transition where workflow_version_id = ${v2!.id}::uuid`);
    expect(transitions.map((t) => t.key)).toEqual(expect.arrayContaining(["send_to_manager", "return_to_engineer"]));

    // C1's item, Submitted to K1, whose engineer sends it to the K1 manager: an internal move.
    const item = await raise(c1.member);
    expect(await take(c1.member, item.id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, item.id)).toBe("picked_up");
    expect(await take(c1Pm, item.id, "submit")).toBe("applied");
    expect(await pickUp(k1.member, item.id)).toBe("picked_up");
    expect(await take(k1.member, item.id, "send_to_manager")).toBe("applied");

    const moves = (as: string) =>
      call<{ key: string }>(
        as,
        sql`select tr.key from work_item_event e join workflow_transition tr on tr.id = e.transition_id where e.work_item_id = ${item.id}::uuid order by e.seq`,
      ).then((rows) => rows.map((r) => r.key));
    expect(await moves(k1.member)).toContain("send_to_manager");
    expect(await moves(c1Pm)).not.toContain("send_to_manager");
    const [seen] = await call<{ key: string }>(
      c1Pm,
      sql`select s.key from app.step_as_seen(${item.id}::uuid) seen join workflow_step s on s.id = seen.step_id`,
    );
    expect(seen!.key).toBe("consultant_review");
    // C2 sees none of C1's item, its Workflow notwithstanding (V3).
    expect(await call(c2.member, sql`select id from work_item where id = ${item.id}::uuid`)).toEqual([]);
  });
});

// RP-448 review: one definition of a Draft Step. app.create_work_item starts a new
// item at the Step app.is_draft_step calls the Draft: a Step whose Stage key is a
// Rabaed Stage of category draft, in whichever Module (a Step has no Module of its
// own until Stages per Project and Module, spec RP-423).
describe("the Draft Step a new item starts at", () => {
  it("is the one app.is_draft_step names, whichever Module's Stage set has its Stage", async () => {
    await migrator.query(
      `insert into stage (owner_kind, module_key, key, name, category, sort)
       values ('rabaed', 'inspections', 'wfown_start', '{"en": "Start (test)", "ar": "البداية (اختبار)"}', 'draft', 90)
       on conflict do nothing`,
    );
    const definition = await workflow("Starts elsewhere (test)", { publish: false });
    const { rows: versions } = await migrator.query(
      "update workflow_step set stage_key = 'wfown_start' where key = 'draft' and workflow_version_id = (select id from workflow_version where workflow_definition_id = $1) returning id",
      [definition],
    );
    await migrator.query("update workflow_version set status = 'published', published_at = now() where workflow_definition_id = $1", [definition]);
    const draftStep = versions[0].id as string;
    expect((await migrator.query("select app.is_draft_step($1) as draft", [draftStep])).rows[0].draft).toBe(true);

    const code = "WFDRF";
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', 'submittals', $1, '{"en": "Draft rule", "ar": "قاعدة المسودة"}', $2, 'review_code', t.form_definition_id
       from work_item_type t where t.id = $3
       on conflict do nothing`,
      [code, definition, typeId],
    );
    await migrator.query("update work_item_type set workflow_definition_id = $2 where owner_kind = 'rabaed' and code = $1", [code, definition]);
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${code}, 'Starts elsewhere', app.latest_form_version(${code}), '{"model": "SE-1"}'::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    expect((await migrator.query("select current_step_id from work_item where id = $1", [created!.work_item_id])).rows[0].current_step_id).toBe(draftStep);
    const [canSave] = await call<{ ok: boolean }>(c1.member, sql`select app.can_save_answers(${created!.work_item_id}::uuid) as ok`);
    expect(canSave!.ok).toBe(true);
  });
});

// RP-448 review: the item read names its Workflow through app.work_item_workflow,
// so a viewer who sees the item but not its Workflow's rows (as an E2 reader will)
// still reads the item. Last in the file: it gives C1 an exception binding.
describe("an item's Workflow name and Version", () => {
  const named = (as: string, id: string) =>
    call<{ name: { en: string }; version_no: number }>(as, sql`select name, version_no from app.work_item_workflow(${id}::uuid)`);

  it("are read by whoever sees the item, even without its Workflow's rows, and by nobody else", async () => {
    const hidden = await workflow("Later out of sight (test)", { owner: { kind: "project", projectId } });
    await bind(hidden, participant.c1);
    const item = await raise(c1.member);
    expect(item.definition).toBe(hidden);
    expect(await named(c1.member, item.id)).toEqual([{ name: { en: "Later out of sight (test)", ar: "Later out of sight (test)" }, version_no: 1 }]);
    // Its definition moves out of the Project's reach (test-only): C1 still sees the item, not the Workflow's rows.
    await migrator.query("update workflow_definition set owner_kind = 'company', project_id = null, company_id = $2 where id = $1", [hidden, x.id]);
    expect(await definitionsRead(c1.member, [hidden])).toEqual([]);
    expect(await call(c1.member, sql`select id from work_item where id = ${item.id}::uuid`)).toHaveLength(1);
    expect(await named(c1.member, item.id)).toEqual([{ name: { en: "Later out of sight (test)", ar: "Later out of sight (test)" }, version_no: 1 }]);
    // A Draft is its raiser's alone (V1): K1 and C2 get nothing, as for an item that doesn't exist.
    for (const as of [k1.member, c2.member, x.member]) expect(await named(as, item.id), as).toEqual([]);
    expect(await named(c1.member, randomUUID())).toEqual([]);
  });
});
