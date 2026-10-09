// Seam 1: a Rabaed Engineer authors a Rabaed Default Workflow in Rabaed Admin (RP-427,
// WF-4; workflow-engine.md §1 "Authoring"; visibility.md V9). They check a definition,
// save it as the draft and publish it as the Type's next Version, each save and publish
// logged in admin_action with its reason; a definition with an error is refused,
// problem by problem, and nothing is published or logged.
import { createDb, readLatestPublishedDefinition } from "@rabaed/db";
import { addTestWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishRabaedWorkflowAs } from "../src/workflows.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const admin = await createTestAdmin();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
  await migrator.destroy();
});

const TYPE = "WFADM";
let definitionId = "";
let engineer: { id: string; browser: Browser };
let current: { versionNo: number; definition: WorkflowDefinition };

const renamed = (definition: WorkflowDefinition, en: string): WorkflowDefinition => ({
  ...definition,
  steps: definition.steps.map((s) => (s.key === "draft" ? { ...s, name: { en, ar: en } } : s)),
});
const broken = (definition: WorkflowDefinition): WorkflowDefinition => ({
  ...definition,
  transitions: definition.transitions.filter((t) => t.key !== "send_for_review"),
});
const actionsOn = (targetId: string) =>
  adminDb.selectFrom("admin_action").select(["engineer_id", "action", "reason"]).where("target_id", "=", targetId).orderBy("at").execute();

beforeAll(async () => {
  const existing = await sql<{ workflow_definition_id: string }>`
    select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${TYPE}
  `.execute(migrator);
  definitionId =
    existing.rows[0]?.workflow_definition_id ??
    (await (async () => {
      const id = await addTestWorkflow((text) => sql.raw(text).execute(migrator), { name: { en: "Admin default (test)", ar: "افتراضي الإدارة" } });
      const schema = {
        sections: [{ key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] }],
      };
      await sql`
        with form as (
          insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Admin test", "ar": "اختبار الإدارة"}') returning id
        ), version as (
          insert into form_version (form_definition_id, version_no, status, published_at, schema)
          select id, 1, 'published', now(), ${JSON.stringify(schema)}::jsonb from form
        )
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', 'submittals', ${TYPE}, '{"en": "Admin test", "ar": "اختبار الإدارة"}', ${id}::uuid, 'review_code', form.id from form
      `.execute(migrator);
      return id;
    })());
  engineer = await admin.signedInEngineer();
  current = (await readLatestPublishedDefinition(adminDb, definitionId))!;
});

describe("a Rabaed Default Workflow in Rabaed Admin", () => {
  it("is checked without a reason, finding every publish problem", async () => {
    const res = await engineer.browser.post(`/v1/workflows/${TYPE}/validate`, { definition: broken(current.definition) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().problems).toContainEqual(expect.objectContaining({ code: "dead_end_step", step: "draft" }));
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/validate`, { definition: current.definition })).json()).toEqual({ issues: [], problems: [] });
  });

  it("is saved as a draft, then published as the next Version, each logged with its reason", async () => {
    const next = renamed(current.definition, "Prepare");
    const saved = await engineer.browser.post(`/v1/workflows/${TYPE}/draft`, { definition: next, reason: "Draft the new Draft Step name" });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await readLatestPublishedDefinition(adminDb, definitionId))!.versionNo).toBe(current.versionNo);

    const published = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: next, reason: "Rename the Draft Step" });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toEqual({ versionNo: current.versionNo + 1 });
    expect(await readLatestPublishedDefinition(adminDb, definitionId)).toEqual({ versionNo: current.versionNo + 1, definition: next });
    expect(await actionsOn(definitionId)).toEqual([
      { engineer_id: engineer.id, action: "save_workflow_draft", reason: "Draft the new Draft Step name" },
      { engineer_id: engineer.id, action: "publish_workflow", reason: "Rename the Draft Step" },
    ]);
  });

  it("is refused with an error, a definition that isn't one, or no reason; nothing is published or logged", async () => {
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const withError = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: broken(before.definition), reason: "Try it" });
    expect(withError.statusCode).toBe(422);
    expect(withError.json()).toMatchObject({ error: "workflow_problems", problems: expect.arrayContaining([expect.objectContaining({ code: "dead_end_step" })]) });
    const notOne = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: { steps: [] }, reason: "Try it" });
    expect(notOne.statusCode).toBe(422);
    expect(notOne.json()).toMatchObject({ error: "invalid_definition" });
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: before.definition, reason: " " })).statusCode).toBe(400);
    expect((await engineer.browser.post(`/v1/workflows/NOPE/publish`, { definition: before.definition, reason: "Try it" })).statusCode).toBe(404);
    expect((await readLatestPublishedDefinition(adminDb, definitionId))!.versionNo).toBe(before.versionNo);
    expect((await actionsOn(definitionId)).length).toBe(2);
  });

  it("is published by the workflow:publish CLI as a named Rabaed Engineer, logged with the reason (V9)", async () => {
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const { email } = await migrator.selectFrom("rabaed_engineer").select("email").where("id", "=", engineer.id).executeTakeFirstOrThrow();
    const next = renamed(before.definition, "Prepare from the CLI");
    const unknown = await publishRabaedWorkflowAs(migrator, { engineerEmail: "nobody@rabaed.test", typeCode: TYPE, definition: next, reason: "CLI" });
    expect(unknown).toEqual({ ok: false, reason: "engineer_not_found" });
    expect((await actionsOn(definitionId)).length).toBe(2);

    const published = await publishRabaedWorkflowAs(migrator, { engineerEmail: email.toUpperCase(), typeCode: TYPE, definition: next, reason: "Publish from the CLI" });
    expect(published).toMatchObject({ ok: true, versionNo: before.versionNo + 1 });
    expect((await actionsOn(definitionId)).at(-1)).toEqual({ engineer_id: engineer.id, action: "publish_workflow", reason: "Publish from the CLI" });
  });

  it("is reached by a signed-in Rabaed Engineer only", async () => {
    expect((await admin.browser().post(`/v1/workflows/${TYPE}/validate`, { definition: current.definition })).statusCode).toBe(401);
    // Before the body is read: a stranger learns nothing of a route's schema.
    for (const path of ["validate", "draft", "publish"]) {
      const res = await admin.browser().post(`/v1/workflows/${TYPE}/${path}`, { definition: 1, reason: 7 });
      expect(res.statusCode, path).toBe(401);
      expect(res.json(), path).toEqual({ error: "not_signed_in" });
    }
  });
});
