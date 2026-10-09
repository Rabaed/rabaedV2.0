// Seam 2 for the Workflow authoring commands (RP-427, WF-4; workflow-engine.md §1
// "Authoring"; visibility.md V20, scenario RP-427-3), as the app role and the migrator:
// - the app role writes no definition table directly: a Workflow, its Versions, Steps,
//   Transitions and the bindings change only through the app.* commands, each audited
//   in workflow_event, which the app role can't read;
// - a draft is read by its authors only, through app.workflow_draft, never through the
//   tables;
// - a Rabaed Default published the way the `workflow:publish` CLI publishes it is what
//   a Project's new items start on at once.
import { randomInt, randomUUID } from "node:crypto";
import type { WorkflowDefinition } from "@rabaed/domain";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, readLatestPublishedDefinition, withMember, writeRabaedDefaultWorkflow, type Db } from "../src/index.ts";
import { addTestWorkflow, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "WFAUT";

let migrator: pg.Client;
let migratorDb: Db;
let app: Db;
let admin = ""; // C1's Authorized Person: created the Project, its Project Admin.
let engineer = ""; // A C1 engineer on the Project, not a Project Admin.
let projectId = "";
let electrical = "";
let buildingA = "";
let typeId = "";
let rabaedDefault = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const call = <T extends object = Record<string, unknown>>(as: string, query: RawBuilder<T> | RawBuilder<unknown>) =>
  withMember(app, as, (trx) => (query as RawBuilder<T>).execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** A test-only Rabaed Type on its own Rabaed Default (the test Workflow), with a small Form. */
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
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: { en: "Authoring default (test)", ar: "افتراضي التأليف" } });
  const form = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [
    JSON.stringify({ en: "Authoring", ar: "التأليف" }),
  ]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2)", [
    form,
    JSON.stringify(schema),
  ]);
  const id = await one(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
    [TYPE, JSON.stringify({ en: "Authoring", ar: "التأليف" }), workflowId, form],
  );
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [id, workflowId]);
  return { typeId: id, workflowId };
}

/** A Draft of the test Type raised by `as`; the Workflow and Version number it is pinned to. */
async function raise(as: string): Promise<{ definition: string; versionNo: number }> {
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
  return { definition: rows[0].definition, versionNo: rows[0].version_no };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  migratorDb = createDb(urls.migrator, { max: 1 });
  app = createDb(urls.app, { max: 2 });
  ({ typeId, workflowId: rabaedDefault } = await addType());
  const rabaedEngineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const company = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: "Authoring Co", ar: "شركة التأليف" }),
    digits(10),
    `3${digits(13)}3`,
    rabaedEngineer,
  ]);
  const member = (who: string, creator: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      company,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      creator,
    ]);
  admin = await member("ap", true);
  engineer = await member("engineer", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [admin, company]);
  const [created] = await call<{ project_id: string }>(admin, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'WFA', 'contractor')`);
  projectId = created!.project_id;
  const participant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        admin,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const kind of ["trade", "location"]) {
    expect(await outcome(admin, sql`select app.set_participant_visibility(${participant}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  await call(admin, sql`select app.add_project_member(${participant}::uuid, ${engineer}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(
      await outcome(admin, sql`select app.set_member_visibility(${participant}::uuid, ${engineer}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
    ).toBe("set");
  }
  expect(await outcome(admin, sql`select app.set_project_member_positions(${participant}::uuid, ${engineer}::uuid, '{engineer}'::text[]) as outcome`)).toBe(
    "set",
  );
});

afterAll(async () => {
  await app?.destroy();
  await migratorDb?.destroy();
  await migrator?.end();
});

describe("the app role and the definition tables", () => {
  let copy = "";

  beforeAll(async () => {
    const [duplicated] = await call<{ outcome: string; workflow_definition_id: string }>(
      admin,
      sql`select * from app.duplicate_workflow(${rabaedDefault}::uuid, ${projectId}::uuid, '{"en": "Tower route", "ar": "مسار البرج"}'::jsonb, now())`,
    );
    expect(duplicated!.outcome).toBe("duplicated");
    copy = duplicated!.workflow_definition_id;
  });

  it("writes none of them directly, not even as the Project Admin", async () => {
    const writes = [
      sql`insert into workflow_definition (owner_kind, project_id, name) values ('project', ${projectId}::uuid, '{"en": "x", "ar": "x"}')`,
      sql`update workflow_definition set name = '{"en": "x", "ar": "x"}' where id = ${copy}::uuid`,
      sql`delete from workflow_definition where id = ${copy}::uuid`,
      sql`insert into workflow_version (workflow_definition_id, version_no, status) values (${copy}::uuid, 9, 'draft')`,
      sql`update workflow_version set status = 'published' where workflow_definition_id = ${copy}::uuid`,
      sql`delete from workflow_step where workflow_version_id in (select id from workflow_version where workflow_definition_id = ${copy}::uuid)`,
      sql`update workflow_transition set label = '{"en": "x", "ar": "x"}'`,
      sql`insert into workflow_binding (project_id, work_item_type_id, workflow_definition_id) values (${projectId}::uuid, ${typeId}::uuid, ${rabaedDefault}::uuid)`,
      sql`delete from workflow_binding`,
      sql`insert into workflow_event (project_id, actor_member_id, type) values (${projectId}::uuid, ${admin}::uuid, 'bound')`,
      sql`select * from workflow_event`,
    ];
    for (const write of writes) {
      await expect(call(admin, write), write.compile(app).sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("reads a draft through app.workflow_draft as its author only, never through the tables (scenario RP-427-3)", async () => {
    const drafts = sql`select v.id from workflow_version v where v.workflow_definition_id = ${copy}::uuid`;
    expect(await call(admin, drafts)).toEqual([]);
    expect(await call(engineer, drafts)).toEqual([]);
    const draft = sql<{ version_no: number }>`select version_no from app.workflow_draft(${copy}::uuid)`;
    expect(await call(admin, draft)).toEqual([{ version_no: 1 }]);
    expect(await call(engineer, draft)).toEqual([]);
    expect(await call(engineer, sql`select app.can_author_workflow(${copy}::uuid) as can`)).toEqual([{ can: false }]);
  });

  it("each command is audited: who, when, what", async () => {
    expect(await outcome(admin, sql`select outcome from app.publish_workflow(${copy}::uuid, now())`)).toBe("published");
    expect(await outcome(admin, sql`select app.bind_workflow(${projectId}::uuid, ${typeId}::uuid, null, ${copy}::uuid, now()) as outcome`)).toBe("bound");
    expect(await outcome(admin, sql`select app.unbind_workflow(${projectId}::uuid, ${typeId}::uuid, null, now()) as outcome`)).toBe("unbound");
    const { rows } = await migrator.query(
      "select type, actor_member_id, project_id from workflow_event where project_id = $1 order by created_at, id",
      [projectId],
    );
    expect(rows).toEqual(
      ["duplicated", "published", "bound", "unbound"].map((type) => ({ type, actor_member_id: admin, project_id: projectId })),
    );
  });

  it("refuses a Member who isn't the Project Admin with not_found, writing nothing", async () => {
    expect(await outcome(engineer, sql`select app.bind_workflow(${projectId}::uuid, ${typeId}::uuid, null, ${copy}::uuid, now()) as outcome`)).toBe(
      "not_found",
    );
    expect(await outcome(engineer, sql`select outcome from app.publish_workflow(${copy}::uuid, now())`)).toBe("not_found");
    expect(
      await outcome(engineer, sql`select outcome from app.duplicate_workflow(${copy}::uuid, ${projectId}::uuid, '{"en": "x", "ar": "x"}'::jsonb, now())`),
    ).toBe("not_found");
    const { rows } = await migrator.query("select count(*)::int as n from workflow_event where actor_member_id = $1", [engineer]);
    expect(rows[0].n).toBe(0);
  });
});

describe("a draft's name is read by its authors only (V20, scenario RP-427-5)", () => {
  const FIRST = { en: "Night shift route", ar: "مسار الوردية الليلية" };
  const RENAMED = { en: "Day shift route", ar: "مسار الوردية النهارية" };
  let route = "";
  const nameOf = (as: string) => call<{ name: unknown }>(as, sql`select name from workflow_definition where id = ${route}::uuid`);

  beforeAll(async () => {
    const [duplicated] = await call<{ outcome: string; workflow_definition_id: string }>(
      admin,
      sql`select * from app.duplicate_workflow(${rabaedDefault}::uuid, ${projectId}::uuid, ${JSON.stringify(FIRST)}::jsonb, now())`,
    );
    route = duplicated!.workflow_definition_id;
  });

  it("hides a Workflow with no published Version from everyone but its authors", async () => {
    expect(await nameOf(engineer)).toEqual([]);
    expect(await nameOf(admin)).toEqual([{ name: FIRST }]);
    expect(await outcome(admin, sql`select outcome from app.publish_workflow(${route}::uuid, now())`)).toBe("published");
    expect(await nameOf(engineer)).toEqual([{ name: FIRST }]);
  });

  it("keeps a rename with the draft until it is published", async () => {
    const [published] = await migrator.query(
      `select v.layout, (select jsonb_agg(jsonb_build_object('key', s.key, 'name', s.name, 'stage_key', s.stage_key,
         'actor_rule', s.actor_rule, 'outcome_mode', s.outcome_mode) order by s.created_at, s.key) from workflow_step s where s.workflow_version_id = v.id) as steps,
         (select jsonb_agg(jsonb_build_object('key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
         'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort, 'action_form', t.action_form) order by t.sort, t.key)
         from workflow_transition t join workflow_step f on f.id = t.from_step_id join workflow_step s on s.id = t.to_step_id
         where t.workflow_version_id = v.id) as transitions
       from workflow_version v where v.workflow_definition_id = $1 and v.status = 'published'`,
      [route],
    ).then((r) => r.rows);
    const saved = await outcome(
      admin,
      sql`select outcome from app.save_workflow_draft(${route}::uuid, ${JSON.stringify(RENAMED)}::jsonb, ${JSON.stringify(published.layout)}::jsonb,
        ${JSON.stringify(published.steps)}::jsonb, ${JSON.stringify(published.transitions)}::jsonb, now())`,
    );
    expect(saved).toBe("saved");
    // The live name, which items show, is still the published one, for authors and Members alike.
    expect(await nameOf(engineer)).toEqual([{ name: FIRST }]);
    expect(await nameOf(admin)).toEqual([{ name: FIRST }]);
    expect(await call(admin, sql`select name from app.workflow_draft(${route}::uuid)`)).toEqual([{ name: RENAMED }]);
    expect(await call(engineer, sql`select name from app.workflow_draft(${route}::uuid)`)).toEqual([]);

    expect(await outcome(admin, sql`select outcome from app.publish_workflow(${route}::uuid, now())`)).toBe("published");
    expect(await nameOf(engineer)).toEqual([{ name: RENAMED }]);
  });
});

describe("Rabaed Admin's draft and publish functions (V9)", () => {
  it("refuse a Project's or a Library's Workflow as not_found, changing nothing", async () => {
    const adminDb = createDb(urls.admin, { max: 1 });
    try {
      const [project] = await call<{ workflow_definition_id: string }>(
        admin,
        sql`select workflow_definition_id from app.duplicate_workflow(${rabaedDefault}::uuid, ${projectId}::uuid, '{"en": "Admin-proof", "ar": "محمي"}'::jsonb, now())`,
      );
      const [library] = await call<{ workflow_definition_id: string }>(
        admin,
        sql`select workflow_definition_id from app.duplicate_workflow(${rabaedDefault}::uuid, null, '{"en": "Library proof", "ar": "مكتبة"}'::jsonb, now())`,
      );
      for (const id of [project!.workflow_definition_id, library!.workflow_definition_id]) {
        const before = await migrator.query("select status, version_no, layout from workflow_version where workflow_definition_id = $1", [id]);
        const written = await sql<{ outcome: string }>`
          select outcome from app.write_workflow_draft(${id}::uuid, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, now())`.execute(adminDb);
        expect(written.rows).toEqual([{ outcome: "not_found" }]);
        const published = await sql<{ outcome: string }>`select outcome from app.mark_workflow_published(${id}::uuid, now())`.execute(adminDb);
        expect(published.rows).toEqual([{ outcome: "not_found" }]);
        const after = await migrator.query("select status, version_no, layout from workflow_version where workflow_definition_id = $1", [id]);
        expect(after.rows).toEqual(before.rows);
      }
    } finally {
      await adminDb.destroy();
    }
  });
});

describe("a Rabaed Default published by the workflow:publish CLI", () => {
  it("is the Version a Project's new item starts on at once", async () => {
    const before = await raise(engineer);
    const current = (await readLatestPublishedDefinition(migratorDb, rabaedDefault))!;
    const next: WorkflowDefinition = {
      ...current.definition,
      steps: current.definition.steps.map((s) => (s.key === "draft" ? { ...s, name: { en: "Prepare", ar: "التحضير" } } : s)),
    };
    const result = await migratorDb.transaction().execute((trx) => writeRabaedDefaultWorkflow(trx, TYPE, next, { publish: true }));
    expect(result).toMatchObject({ ok: true, versionNo: current.versionNo + 1 });
    const after = await raise(engineer);
    expect(after).toEqual({ definition: rabaedDefault, versionNo: current.versionNo + 1 });
    expect(before.versionNo).toBe(current.versionNo);
    // What it published reads back as it was given.
    expect((await readLatestPublishedDefinition(migratorDb, rabaedDefault))!.definition).toEqual(next);
  });

  it("refuses a definition with an error, publishing nothing", async () => {
    const current = (await readLatestPublishedDefinition(migratorDb, rabaedDefault))!;
    const broken = { ...current.definition, transitions: current.definition.transitions.filter((t) => t.key !== "send_for_review") };
    const result = await migratorDb.transaction().execute((trx) => writeRabaedDefaultWorkflow(trx, TYPE, broken, { publish: true }));
    expect(result).toMatchObject({ ok: false, reason: "workflow_problems" });
    expect((await readLatestPublishedDefinition(migratorDb, rabaedDefault))!.versionNo).toBe(current.versionNo);
  });
});
