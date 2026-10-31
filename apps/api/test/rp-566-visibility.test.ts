// Seam 1 for what a Rabaed Default Version a Project lacks an outcome of tells whom (RP-566;
// workflow-engine.md "Rabaed Admin -> Workflows"; visibility.md V9; scenario RP-566-1). Publishing it is
// refused `projects_lack_entries` with how many Projects and which outcomes, never which Project; no
// Member's route publishes a Rabaed Default; putting the Tower back on it is refused
// `default_lacks_entries`, naming the Tower's own missing outcomes to its Project Admin only, and a plain
// 404 to anyone else. Once the Project Admin adds the outcome, the binding goes and new items start on
// the Rabaed Default with no outcome outside the Project's set. A test Rabaed Type of its own (MAR's
// shape), so no other suite's Default changes. Rabaed Admin's routes, its `workflow:publish` CLI and
// the refusal's admin_action row are apps/admin/test/workflows.test.ts's. Seam 2:
// packages/db/test/rp-566-visibility-rls.test.ts.
import { createDb, readLatestPublishedDefinition, writeRabaedDefaultWorkflow } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition, WorkflowSettings } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "RLV";
const code = `V${Math.random().toString(36).slice(2, 7)}`;

let c1: Company; // The Tower's Host Company: its Authorized Person is the Project Admin.
let at: Tower;
let other: Company; // The Project Admin of another Project.
let c2Ap: Caller; // C2's Authorized Person: on the Tower, no Project Admin.
let c2ParticipantId = "";
let typeId = "";
let defaultId = "";
let copyId = "";
let withCode: WorkflowDefinition;
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
const bindings = () => `/v1/projects/${at.projectId}/workflow-bindings`;
const settings = async (by: Caller): Promise<WorkflowSettings> => (await ok(by.get(`/v1/projects/${at.projectId}/workflow-settings`), 200)).json();
const latestVersionNo = async () => (await readLatestPublishedDefinition(migrator, defaultId))!.versionNo;

/** The outcomes `by` is told the Tower lacks when they take its Project-wide binding away (so it falls back to the Rabaed Default); none for the plain 404. */
const toldLacking = async (by: Caller) => {
  const res = await by.request("DELETE", `${bindings()}?workItemTypeId=${typeId}`);
  if (res.statusCode === 409) return (res.json().outcomes as string[]).map((outcome) => ({ id: outcome }));
  expect({ status: res.statusCode, body: res.body }, named(by)).toEqual({ status: 404, body: JSON.stringify({ error: "not_found" }) });
  return [];
};

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  other = await api.projectCreator();
  at = await buildTower(api, { c1, k1 }, "RLV");
  await api.createProject(other.caller, { code: "RLX" });
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Ap = c2.caller;
  await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  for (const [by, name] of [[c1.caller, "the Tower's Project Admin"], [at.c1Engineer, "a plain Tower Member"], [at.k1Manager, "K1's manager"], [c2Ap, "C2's Authorized Person"], [other.caller, "another Project's Admin"]] as const)
    names.set(by, name);

  // The Type's Rabaed Default, published with MAR's definition.
  defaultId = (await sql<{ id: string }>`insert into workflow_definition (owner_kind, name) values ('rabaed', ${JSON.stringify(bilingual("Lacking (RP-566-1)"))}::jsonb) returning id`.execute(migrator))
    .rows[0]!.id;
  typeId = (
    await sql<{ id: string }>`
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select 'rabaed', m.module_key, ${TYPE}, ${JSON.stringify(bilingual("Lacking (RP-566-1)"))}::jsonb, ${defaultId}::uuid, m.outcome_kind, m.form_definition_id
      from work_item_type m where m.owner_kind = 'rabaed' and m.code = 'MAR' returning id
    `.execute(migrator)
  ).rows[0]!.id;
  const marWorkflowId = (await sql<{ id: string }>`select workflow_definition_id as id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'`.execute(migrator)).rows[0]!.id;
  const mar = (await readLatestPublishedDefinition(migrator, marWorkflowId))!;
  expect(await writeRabaedDefaultWorkflow(migrator, TYPE, mar.definition, { publish: true })).toMatchObject({ ok: true });
  const a = mar.definition.transitions.find((tr) => tr.key === "approve_a")!;
  withCode = { ...mar.definition, transitions: [...mar.definition.transitions, { ...a, key: "approve_v", label: bilingual(`Approve · ${code}`), outcome: code }] };

  // The Tower runs its own copy Project-wide; an exception keeps C2 on the Rabaed Default.
  copyId = (await ok(c1.caller.post(`/v1/workflows/${defaultId}/duplicate`, { projectId: at.projectId, name: bilingual("Tower's own (RP-566-1)") }), 201)).json().id;
  await ok(c1.caller.post(`/v1/workflows/${copyId}/publish`), 200);
  await ok(c1.caller.request("PUT", bindings(), { workItemTypeId: typeId, raisingParticipantId: null, workflowId: copyId }));
  await ok(c1.caller.request("PUT", bindings(), { workItemTypeId: typeId, raisingParticipantId: c2ParticipantId, workflowId: defaultId }));

  // Rabaed adds an outcome to the Type's set: every Project but the Tower already holds it.
  await sql`
    insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
    select 'rabaed', null, ${typeId}::uuid, ${code}, ${JSON.stringify(bilingual("On site"))}::jsonb, true, 'positive', '[]'::jsonb, 99
  `.execute(migrator);
  await sql`
    insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
    select 'project', p.id, ${typeId}::uuid, ${code}, ${JSON.stringify(bilingual("On site"))}::jsonb, true, 'positive', '[]'::jsonb, 99
    from project p where p.id <> ${at.projectId}::uuid
      and not exists (select 1 from outcome o where o.project_id = p.id and o.work_item_type_id = ${typeId}::uuid and o.code = ${code})
  `.execute(migrator);
});

describe("scenario RP-566-1: a Rabaed Default Version that uses an outcome the Tower lacks", () => {
  it("is refused while C2's exception keeps C2 on the Rabaed Default, with the count and the outcomes only, and nothing is published", async () => {
    const before = await latestVersionNo();
    // No Project, Company or id: the whole answer.
    expect(await writeRabaedDefaultWorkflow(migrator, TYPE, withCode, { publish: true })).toEqual({ ok: false, reason: "projects_lack_entries", projects: 1, outcomes: [code], stages: [] });
    expect(await latestVersionNo()).toBe(before);
  });

  it("is published by no Member's route: the Project Admin's draft save and publish of the Rabaed Default are the plain 404", async () => {
    const before = await latestVersionNo();
    // The same routes publish the Tower's own copy (beforeAll): the positive control.
    for (const res of [await c1.caller.request("PUT", `/v1/workflows/${defaultId}/draft`, { definition: withCode }), await c1.caller.post(`/v1/workflows/${defaultId}/publish`)]) {
      expect({ status: res.statusCode, body: res.body }).toEqual({ status: 404, body: JSON.stringify({ error: "not_found" }) });
    }
    expect(await latestVersionNo()).toBe(before);
  });

  it("publishes once the Project Admin removes C2's exception, so the Tower runs the Default no more", async () => {
    const before = await latestVersionNo();
    await ok(c1.caller.request("DELETE", `${bindings()}?workItemTypeId=${typeId}&raisingParticipantId=${c2ParticipantId}`));
    expect(await writeRabaedDefaultWorkflow(migrator, TYPE, withCode, { publish: true })).toMatchObject({ ok: true, versionNo: before + 1 });
  });

  it("refuses putting the Tower or C2 back on it, naming the Tower's own missing outcome to its Project Admin only", async () => {
    const refused = { error: "default_lacks_entries", outcomes: [code], stages: [] };
    for (const raisingParticipantId of [c2ParticipantId, null]) {
      const bind = await c1.caller.request("PUT", bindings(), { workItemTypeId: typeId, raisingParticipantId, workflowId: defaultId });
      expect({ status: bind.statusCode, body: bind.json() }).toEqual({ status: 409, body: refused });
    }
    await expectHiddenFrom({
      read: toldLacking,
      target: code,
      seenBy: c1.caller,
      hiddenFrom: [at.c1Engineer, at.k1Manager, c2Ap, other.caller],
      name: named,
      label: "the outcome the Tower lacks",
    });
    expect((await settings(c1.caller)).types.find((t) => t.code === TYPE)!.workflow).toMatchObject({ id: copyId, source: "project_copy" });
  });

  it("goes back once the Project Admin adds the outcome, and the Tower's new items start on a Version with no outcome outside its set", async () => {
    await ok(c1.caller.post(`/v1/projects/${at.projectId}/work-item-types/${TYPE}/outcomes`, { code, name: bilingual("On site"), closing: true, polarity: "positive", actions: [] }), 201);
    await ok(c1.caller.request("DELETE", `${bindings()}?workItemTypeId=${typeId}`));
    expect((await settings(c1.caller)).types.find((t) => t.code === TYPE)!.workflow).toMatchObject({ id: defaultId, source: "rabaed_default", versionNo: await latestVersionNo() });
    const { rows } = await sql<{ version_no: number; outside: string[] }>`
      with v as (select app.new_item_workflow_version(${at.projectId}::uuid, ${typeId}::uuid, null) as id)
      select (select version_no from workflow_version where id = v.id) as version_no,
        array(select t.outcome from workflow_transition t where t.workflow_version_id = v.id and t.outcome is not null
          and not exists (select 1 from outcome o where o.project_id = ${at.projectId}::uuid and o.work_item_type_id = ${typeId}::uuid and o.code = t.outcome and o.closing)) as outside
      from v
    `.execute(migrator);
    // The Version new items start on is the Default's latest, and it has no outcome outside the Tower's set.
    expect(rows).toEqual([{ version_no: await latestVersionNo(), outside: [] }]);
  });
});
