// Seam 1 for outcome sets (RP-429, WF-6; spec RP-423; glossary Outcome;
// workflow-engine.md §1 "Outcomes"; data-model.md outcome). Each Work Item Type
// has its own outcome set; a Project runs its own copy of a Rabaed Default
// Type's. Every Project Member reads it, as they read the Type; only a Project
// Admin adds an outcome or changes one's names, follow-up actions and order.
// An outcome added there is usable by a Workflow published against the Project's
// set, and the Dashboard and the List show it with its English and Arabic name.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  defaultOutcomeSets,
  definitionFromRows,
  formSchema,
  workflowPublishProblems,
  workItemSearchParams,
  type Dashboard,
  type StageCategory,
  type TypeOutcomes,
  type WorkflowVersionRows,
  type WorkItemList,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type TestApi } from "./support/harness.ts";
import { buildTower, ok, type Company, type Tower } from "./support/tower.ts";

let api: TestApi;
let c1: Company;
let k1: Company;
let outsider: Company;
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });

beforeAll(async () => {
  api = await createTestApi({ files: true });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  outsider = await api.projectCreator();
});

afterAll(async () => {
  await api?.close();
  await migrator.destroy();
});

const e = { code: "E", name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" }, closing: true, polarity: "positive", actions: [] } as const;

const outcomesPath = (at: Tower, type = "MAR") => `/v1/projects/${at.projectId}/work-item-types/${type}/outcomes`;
const outcomesOf = async (by: Caller, at: Tower, type = "MAR"): Promise<TypeOutcomes> => (await ok(by.get(outcomesPath(at, type)), 200)).json();
const add = (by: Caller, at: Tower, body: unknown, type = "MAR") => by.post(outcomesPath(at, type), body);
const change = (by: Caller, at: Tower, code: string, body: unknown) => by.request("PATCH", `${outcomesPath(at)}/${code}`, body);
const reorder = (by: Caller, at: Tower, codes: string[]) => by.request("PUT", `${outcomesPath(at)}/order`, { codes });

describe("a Project's outcome sets", () => {
  it("are the Rabaed Default sets, read by every Project Member, editable by its Project Admin only", async () => {
    const t = await buildTower(api, { c1, k1 }, "OSA");
    const byAdmin = await outcomesOf(c1.caller, t);
    expect(byAdmin).toEqual({
      type: { code: "MAR", name: { en: "Material Submittal", ar: "اعتماد المواد" } },
      canEdit: true,
      outcomes: defaultOutcomeSets.review_code,
    });
    const byConsultant = await outcomesOf(t.k1Manager, t);
    expect(byConsultant).toEqual({ ...byAdmin, canEdit: false });
  });

  it("are hidden from anyone not on the Project, and for a Type the Project doesn't use, as a made-up Project is", async () => {
    const t = await buildTower(api, { c1, k1 }, "OSH");
    await expectHidden(outsider.caller.get(outcomesPath(t)));
    await expectHidden(c1.caller.get(outcomesPath(t, "NOPE")));
    await expectHidden(c1.caller.get(`/v1/projects/00000000-0000-4000-8000-000000000000/work-item-types/MAR/outcomes`));
  });

  it("gain an outcome the Project Admin adds, last, on that Project only; the Rabaed Default set stays", async () => {
    const t = await buildTower(api, { c1, k1 }, "OSB");
    const other = await buildTower(api, { c1, k1 }, "OSC");
    expect((await ok(add(c1.caller, t, e), 201)).json()).toEqual({ code: "E" });
    expect((await outcomesOf(t.k1Manager, t)).outcomes).toEqual([...defaultOutcomeSets.review_code, e]);
    expect((await outcomesOf(c1.caller, other)).outcomes).toEqual(defaultOutcomeSets.review_code);
    const rabaed = await sql<{ code: string }>`
      select o.code from outcome o join work_item_type t on t.id = o.work_item_type_id
      where t.code = 'MAR' and o.owner_kind = 'rabaed' order by o.sort
    `.execute(migrator);
    expect(rabaed.rows.map((r) => r.code)).toEqual(["A", "B", "C", "D"]);
  });

  it("refuse an outcome the set has, a code it can't hold, and anyone but the Project Admin", async () => {
    const t = await buildTower(api, { c1, k1 }, "OSD");
    expect((await add(c1.caller, t, { ...e, code: "A" })).statusCode).toBe(409);
    expect((await add(c1.caller, t, { ...e, code: "cancelled" })).statusCode).toBe(400);
    expect((await add(c1.caller, t, { ...e, actions: [{ kind: "offer_revision" }, { kind: "offer_revision" }] })).statusCode).toBe(400);
    await expectHidden(add(t.k1Manager, t, e));
    await expectHidden(add(outsider.caller, t, e));
    await expectHidden(add(c1.caller, t, e, "NOPE"));
    expect((await outcomesOf(c1.caller, t)).outcomes).toEqual(defaultOutcomeSets.review_code);
  });

  it("change an outcome's names and follow-up actions, and their order", async () => {
    const t = await buildTower(api, { c1, k1 }, "OSE");
    const name = { en: "Approved, with Comments to close", ar: "معتمد مع ملاحظات للإغلاق" };
    await ok(change(c1.caller, t, "B", { name, actions: [{ kind: "create_items", type: "CMT" }, { kind: "offer_revision" }] }));
    expect((await outcomesOf(t.k1Manager, t)).outcomes[1]).toEqual({
      code: "B",
      name,
      closing: true,
      polarity: "positive",
      actions: [{ kind: "create_items", type: "CMT" }, { kind: "offer_revision" }],
    });
    // Its code, closing and polarity stay.
    expect((await change(c1.caller, t, "B", { name, actions: [], polarity: "negative" })).statusCode).toBe(400);
    await expectHidden(change(t.k1Manager, t, "B", { name, actions: [] }));
    await expectHidden(change(c1.caller, t, "Z", { name, actions: [] }));
    await ok(reorder(c1.caller, t, ["D", "C", "B", "A"]));
    expect((await outcomesOf(c1.caller, t)).outcomes.map((o) => o.code)).toEqual(["D", "C", "B", "A"]);
    expect((await reorder(c1.caller, t, ["A"])).statusCode).toBe(422);
  });
});

/**
 * A Type `code` whose Workflow is the Project's own (owner `project`): the MAR's
 * latest Version, copied, plus "Approve for construction · E" from the Consultant's
 * issuing Step, as WF-3's binding will run a Project's Workflow for a Type. Its Form
 * is the MAR's. Returns the Workflow definition's id; the Version is added by
 * `publishWithE` once the Project's set has E.
 */
async function projectType(at: Tower, code: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    with definition as (
      insert into workflow_definition (owner_kind, project_id, name)
      values ('project', ${at.projectId}::uuid, '{"en": "MAR with E (test)", "ar": "اعتماد المواد مع E (اختبار)"}')
      returning id
    )
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    select 'rabaed', 'submittals', ${code}, '{"en": "Material Submittal with E", "ar": "اعتماد المواد مع E"}', d.id, 'review_code', t.form_definition_id
    from definition d, work_item_type t where t.code = 'MAR' and t.owner_kind = 'rabaed'
    returning workflow_definition_id as id
  `.execute(migrator);
  return rows[0]!.id;
}

/** The MAR's latest Version with "approve_e" added, as Version 1 of `definitionId`, as a draft. */
async function draftWithE(definitionId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    with mar as (
      select v.id, v.layout from workflow_version v
      join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
      where t.code = 'MAR' and t.owner_kind = 'rabaed' and v.status = 'published'
      order by v.version_no desc limit 1
    ), version as (
      insert into workflow_version (workflow_definition_id, version_no, status, layout)
      select ${definitionId}::uuid, 1, 'draft', mar.layout from mar
      returning id
    ), steps as (
      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode)
      select version.id, s.key, s.name, s.stage_key, s.actor_rule, s.is_signing, s.outcome_mode
      from version, mar join workflow_step s on s.workflow_version_id = mar.id
      returning id, key, workflow_version_id
    ), source as (
      -- Every Transition of the MAR, and approve_a once more as approve_e.
      select tr.*, f.key as from_key, s.key as to_key, e.is_e
      from mar
      join workflow_transition tr on tr.workflow_version_id = mar.id
      join workflow_step f on f.id = tr.from_step_id
      join workflow_step s on s.id = tr.to_step_id
      cross join lateral (select false as is_e union all select true where tr.key = 'approve_a') e
    )
    insert into workflow_transition (
      workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form, rules, actions, notifications)
    select f.workflow_version_id,
      case when src.is_e then 'approve_e' else src.key end,
      f.id, s.id,
      case when src.is_e then '{"en": "Approve for construction · E", "ar": "اعتماد للتنفيذ · E"}'::jsonb else src.label end,
      src.kind,
      case when src.is_e then 'E' else src.outcome end,
      -- Sorted last, as a Version's rows number them (definitionToRows).
      src.permission, case when src.is_e then (select max(x.sort) + 1 from source x) else src.sort end,
      src.action_form, src.rules, src.actions, src.notifications
    from source src
    join steps f on f.key = src.from_key
    join steps s on s.key = src.to_key
    returning workflow_version_id as id
  `.execute(migrator);
  return rows[0]!.id;
}

/** The publish checks of `versionId` against Type `code`'s outcome set as its Project's Admin reads it, the Project's Stages and the MAR's Form. */
async function publishProblems(at: Tower, versionId: string, code: string, outcomes: readonly { code: string; closing: boolean }[]) {
  const steps = await sql<WorkflowVersionRows["steps"][number]>`
    select key, name, stage_key, actor_rule, is_signing, outcome_mode from workflow_step where workflow_version_id = ${versionId}::uuid order by key
  `.execute(migrator);
  const transitions = await sql<WorkflowVersionRows["transitions"][number] & { rules: unknown; actions: unknown }>`
    select tr.key, f.key as from_step_key, s.key as to_step_key, tr.label, tr.kind, tr.outcome, tr.permission, tr.sort, tr.action_form, tr.rules, tr.actions
    from workflow_transition tr
    join workflow_step f on f.id = tr.from_step_id
    join workflow_step s on s.id = tr.to_step_id
    where tr.workflow_version_id = ${versionId}::uuid order by tr.sort
  `.execute(migrator);
  const stages = await sql<{ key: string; category: StageCategory }>`
    select key, category from stage where project_id = ${at.projectId}::uuid and module_key = 'submittals'
  `.execute(migrator);
  const form = await sql<{ schema: unknown }>`
    select f.schema from form_version f join work_item_type t on t.form_definition_id = f.form_definition_id
    where t.code = ${code} and f.status = 'published' order by f.version_no desc limit 1
  `.execute(migrator);
  const rows: WorkflowVersionRows = {
    layout: {},
    steps: steps.rows,
    transitions: transitions.rows.map(({ rules, actions, ...t }) => ({ ...t, ...(rules === null ? {} : { rules }), ...(actions === null ? {} : { actions }) })),
  };
  return workflowPublishProblems(definitionFromRows(rows), { outcomes, stages: stages.rows, form: formSchema.parse(form.rows[0]!.schema) }).map((p) => p.code);
}

describe("an outcome the Project Admin added", () => {
  let t: Tower;
  let item = "";
  const code = "MARE";

  beforeAll(async () => {
    t = await buildTower(api, { c1, k1 }, "OSF");
    const definitionId = await projectType(t, code);
    const version = await draftWithE(definitionId);
    // Not publishable against the Type's set before the Project has E.
    expect(await publishProblems(t, version, code, (await outcomesOf(c1.caller, t, code)).outcomes)).toEqual(["outcome_not_in_set"]);
    await ok(add(c1.caller, t, e, code), 201);
    expect(await publishProblems(t, version, code, (await outcomesOf(c1.caller, t, code)).outcomes)).toEqual([]);
    await sql`update workflow_version set status = 'published', published_at = now() where id = ${version}::uuid`.execute(migrator);

    // C1 raises one and Submits it; K1 verifies it and issues E.
    const created = await t.c1Engineer.post(`/v1/projects/${t.projectId}/work-items`, {
      type: code,
      title: "Cable trays for construction",
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: t.electrical, location: t.buildingA },
    });
    expect(created.statusCode, created.body).toBe(201);
    item = created.json().id;
    await attachDatasheet(t.c1Engineer, item);
    await ok(t.c1Engineer.post(`/v1/work-items/${item}/transitions`, { transition: "send_for_review", confirmed: true, idempotencyKey: randomUUID() }));
    await ok(t.c1Pm.post(`/v1/work-items/${item}/claim`));
    await ok(t.c1Pm.post(`/v1/work-items/${item}/transitions`, { transition: "submit", confirmed: true, idempotencyKey: randomUUID() }));
    const answers = (await ok(t.k1Manager.get(`/v1/work-items/${item}`), 200)).json().answers as Record<string, unknown>;
    await ok(t.k1Manager.request("PUT", `/v1/work-items/${item}/answers`, { answers: { ...answers, sample_checked: true, matches_specification: true } }));
    await ok(t.k1Manager.post(`/v1/work-items/${item}/claim`));
    await ok(t.k1Manager.post(`/v1/work-items/${item}/transitions`, { transition: "approve_e", answers: {}, confirmed: true, idempotencyKey: randomUUID() }));
  });

  it("closes the item with it, from the published Workflow", async () => {
    const detail = (await ok(t.c1Engineer.get(`/v1/work-items/${item}`), 200)).json();
    expect(detail.outcome).toBe("E");
  });

  it("shows on the Dashboard as its own bar, with its English and Arabic name, counted as approved", async () => {
    for (const by of [t.c1Engineer, t.k1Manager]) {
      const d: Dashboard = (await ok(by.get(`/v1/projects/${t.projectId}/dashboard`), 200)).json();
      const card = d.modules.flatMap((m) => m.cards).find((c) => c.type.code === code)!;
      if (card.kind !== "outcomes") throw new Error("expected an outcomes card");
      expect(card.bars.map((b) => b.bucket)).toEqual(["pending", "C", "A", "B", "E", "D"]);
      expect(card.bars.find((b) => b.bucket === "E")).toMatchObject({ count: 1, name: e.name, tone: "positive" });
      expect(card.approved).toMatchObject({ count: 1, percent: 100 });
      // Its number opens the List of exactly that item.
      const bar = card.bars.find((b) => b.bucket === "E")!;
      const list: WorkItemList = (await ok(by.get(`/v1/projects/${t.projectId}/work-items?${workItemSearchParams(bar.query)}`), 200)).json();
      expect(list.items.map((i) => i.id)).toEqual([item]);
    }
  });

  it("shows on the List with its outcome, filtered by it, named in English and Arabic", async () => {
    const list: WorkItemList = (await ok(t.k1Manager.get(`/v1/projects/${t.projectId}/work-items?${workItemSearchParams({ outcome: ["E"] })}`), 200)).json();
    expect(list.items.map((i) => [i.id, i.outcome])).toEqual([[item, "E"]]);
    expect(list.filters.outcomes.filter((o) => o.type === code).map((o) => o.code)).toEqual(["A", "B", "C", "D", "E"]);
    expect(list.filters.outcomes.find((o) => o.type === code && o.code === "E")).toEqual({ type: code, ...e });
  });
});
