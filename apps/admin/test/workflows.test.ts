// Seam 1: a Rabaed Engineer authors a Rabaed Default Workflow in Rabaed Admin (RP-427,
// WF-4; workflow-engine.md §1 "Authoring"; visibility.md V9). They check a definition,
// save it as the draft and publish it as the Type's next Version, each save and publish
// logged in admin_action with its reason; a definition with an error is refused,
// problem by problem, and nothing is published or logged.
import { randomInt, randomUUID } from "node:crypto";
import { createDb, readLatestPublishedDefinition, withMember } from "@rabaed/db";
import { addTestScreen, addTestWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reorderDefaultOutcomes, reorderDefaultStages } from "../src/workflow-defaults.ts";
import { publishRabaedWorkflowAs } from "../src/workflows.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const admin = await createTestAdmin();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
const appDb = createDb(testDatabaseUrls().app, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
  await migrator.destroy();
  await appDb.destroy();
});

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

/** A new Project of a new Company, created as its Members create one (`app.create_project`): it copies the Rabaed Defaults as they are now. */
async function newProject(): Promise<string> {
  const { id: engineerId } = await migrator
    .insertInto("rabaed_engineer")
    .values({ email: `eng-${randomUUID().slice(0, 8)}@rabaed.test`, full_name: "Seam One" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const company = await sql<{ id: string }>`
    insert into company (legal_name, cr_number, vat_number, onboarded_by)
    values ('{"en": "Defaults", "ar": "افتراضي"}', ${digits(10)}, ${`3${digits(13)}3`}, ${engineerId}) returning id
  `.execute(migrator);
  const member = await sql<{ id: string }>`
    insert into member (company_id, email, full_name, status, can_create_projects)
    values (${company.rows[0]!.id}, ${`creator-${randomUUID().slice(0, 8)}@rabaed.test`}, '{"en": "Creator", "ar": "المنشئ"}', 'active', true) returning id
  `.execute(migrator);
  const memberId = member.rows[0]!.id;
  await sql`update company set authorized_person_id = ${memberId} where id = ${company.rows[0]!.id}`.execute(migrator);
  return withMember(appDb, memberId, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Later", "ar": "لاحق"}'::jsonb, 'DEF', 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
}

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
      const id = await addTestWorkflow((text) => sql.raw(text).execute(migrator), { name: { en: "Admin default (test)", ar: "افتراضي الإدارة" }, engineerStep: true });
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

  it("keeps the builder's Change Note with the Version it publishes (RP-555), apart from the reason admin_action logs", async () => {
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const next = renamed(before.definition, "Prepare and check");
    const published = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, {
      definition: next,
      reason: "Rename the Draft Step again",
      changeNote: "  The Draft Step checks the submittal before it is sent.  ",
    });
    expect(published.statusCode, published.body).toBe(200);
    const { versionNo } = published.json() as { versionNo: number };
    expect(versionNo).toBe(before.versionNo + 1);
    const kept = await sql<{ change_note: string }>`
      select n.change_note from workflow_change_note n join workflow_version v on v.id = n.workflow_version_id
      where v.workflow_definition_id = ${definitionId} and v.version_no = ${versionNo}
    `.execute(migrator);
    expect(kept.rows).toEqual([{ change_note: "The Draft Step checks the submittal before it is sent." }]);
    expect((await actionsOn(definitionId)).at(-1)).toEqual({ engineer_id: engineer.id, action: "publish_workflow", reason: "Rename the Draft Step again" });
  });

  it("is refused with an error, a definition that isn't one, or no reason; nothing is published or logged", async () => {
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const logged = (await actionsOn(definitionId)).length;
    const withError = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: broken(before.definition), reason: "Try it" });
    expect(withError.statusCode).toBe(422);
    expect(withError.json()).toMatchObject({ error: "workflow_problems", problems: expect.arrayContaining([expect.objectContaining({ code: "dead_end_step" })]) });
    const notOne = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: { steps: [] }, reason: "Try it" });
    expect(notOne.statusCode).toBe(422);
    expect(notOne.json()).toMatchObject({ error: "invalid_definition" });
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: before.definition, reason: " " })).statusCode).toBe(400);
    expect((await engineer.browser.post(`/v1/workflows/NOPE/publish`, { definition: before.definition, reason: "Try it" })).statusCode).toBe(404);
    expect((await readLatestPublishedDefinition(adminDb, definitionId))!.versionNo).toBe(before.versionNo);
    expect((await actionsOn(definitionId)).length).toBe(logged);
  });

  it("is published by the workflow:publish CLI as a named Rabaed Engineer, logged with the reason (V9)", async () => {
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const { email } = await migrator.selectFrom("rabaed_engineer").select("email").where("id", "=", engineer.id).executeTakeFirstOrThrow();
    const next = renamed(before.definition, "Prepare from the CLI");
    const logged = (await actionsOn(definitionId)).length;
    const unknown = await publishRabaedWorkflowAs(migrator, { engineerEmail: "nobody@rabaed.test", typeCode: TYPE, definition: next, reason: "CLI" });
    expect(unknown).toEqual({ ok: false, reason: "engineer_not_found" });
    expect((await actionsOn(definitionId)).length).toBe(logged);

    const published = await publishRabaedWorkflowAs(migrator, { engineerEmail: email.toUpperCase(), typeCode: TYPE, definition: next, reason: "Publish from the CLI" });
    expect(published).toMatchObject({ ok: true, versionNo: before.versionNo + 1 });
    expect((await actionsOn(definitionId)).at(-1)).toEqual({ engineer_id: engineer.id, action: "publish_workflow", reason: "Publish from the CLI" });
  });

  it("shows a Rabaed Default Screen: Rabaed Admin reads the Screens, checks and pins it (RP-525 review)", async () => {
    const key = `admin_reply_${randomUUID().slice(0, 8).replaceAll("-", "")}`;
    const reply = { sections: [{ key: "reply", title: { en: "Reply", ar: "الرد" }, fields: [{ key: "remarks", type: "textarea", label: { en: "Remarks", ar: "ملاحظات" } }] }] };
    const screenVersionId = await addTestScreen((text) => sql.raw(text).execute(migrator), key, reply, []);
    const before = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const showing = (screen: string): WorkflowDefinition => ({
      ...before.definition,
      transitions: before.definition.transitions.map((t) => (t.key === "approve_a" ? { ...t, actionForm: null, screen } : t)),
    });
    const missing = await engineer.browser.post(`/v1/workflows/${TYPE}/validate`, { definition: showing(`${key}_missing`) });
    expect(missing.json().problems).toContainEqual(expect.objectContaining({ code: "screen_not_found", transition: "approve_a" }));
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/validate`, { definition: showing(key) })).json()).toEqual({ issues: [], problems: [] });

    const published = await engineer.browser.post(`/v1/workflows/${TYPE}/publish`, { definition: showing(key), reason: "Show the reply Screen" });
    expect(published.statusCode, published.body).toBe(200);
    const pinned = await sql<{ screen_version_id: string | null }>`
      select t.screen_version_id from workflow_transition t
      join workflow_version v on v.id = t.workflow_version_id
      where v.workflow_definition_id = ${definitionId}::uuid and v.version_no = ${before.versionNo + 1} and t.key = 'approve_a'
    `.execute(adminDb);
    expect(pinned.rows).toEqual([{ screen_version_id: screenVersionId }]);
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

// Rabaed Admin -> Workflows (RP-443, WF-20): the list, the builder's read, duplicating, and the
// Rabaed Default outcome and Stage sets, each change logged with its reason (V9).
describe("Rabaed Admin's Workflows screen (visibility scenario RP-443-1)", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const outcomeCode = `X${suffix}`;
  const stageKey = `hold_${suffix}`;
  const name = (en: string) => ({ en, ar: `${en} (ar)` });
  // The Rabaed Default sets are shared by every suite: leave them as they were found.
  afterAll(async () => {
    await migrator.deleteFrom("stage").where("key", "=", stageKey).execute();
    await migrator.deleteFrom("outcome").where("code", "=", outcomeCode).execute();
  });
  /** Project `projectId`'s copy of outcome `code` of the test Type, if it has one. */
  const projectCopy = (projectId: string, code: string) =>
    migrator
      .selectFrom("outcome")
      .innerJoin("work_item_type", "work_item_type.id", "outcome.work_item_type_id")
      .select(["outcome.name", "outcome.actions", "outcome.sort"])
      .where("work_item_type.code", "=", TYPE)
      .where("outcome.code", "=", code)
      .where("outcome.project_id", "=", projectId)
      .execute();
  /** Project `projectId`'s own Submittals Stage `key`, if it has one. */
  const projectStage = (projectId: string, key: string) =>
    migrator.selectFrom("stage").select("name").where("project_id", "=", projectId).where("module_key", "=", "submittals").where("key", "=", key).execute();

  it("lists the Rabaed Default Workflows by Type with their Versions", async () => {
    const res = await engineer.browser.get("/v1/workflows");
    expect(res.statusCode, res.body).toBe(200);
    const row = res.json().types.find((t: { code: string }) => t.code === TYPE);
    expect(row).toMatchObject({ code: TYPE, moduleKey: "submittals", hasDraft: expect.any(Boolean) });
    expect(row.publishedVersions.length).toBeGreaterThan(0);
    expect(res.json().types.some((t: { code: string }) => t.code === "MAR")).toBe(true);
  });

  it("reads one for the builder: its Versions, draft, Stages, outcome set and Positions", async () => {
    const res = await engineer.browser.get(`/v1/workflows/${TYPE}`);
    expect(res.statusCode, res.body).toBe(200);
    const read = res.json();
    expect(read.type.code).toBe(TYPE);
    expect(read.workflow).toMatchObject({ id: definitionId, owner: "rabaed", canAuthor: true });
    expect(read.workflow.published.definition.steps.length).toBeGreaterThan(0);
    expect(read.stages.length).toBeGreaterThan(0);
    expect(read.outcomeSet.map((o: { code: string }) => o.code)).toContain("A");
    expect(read.positions.length).toBeGreaterThan(0);
    expect((await engineer.browser.get(`/v1/workflows/NOPE`)).statusCode).toBe(404);
    expect((await admin.browser().get(`/v1/workflows/${TYPE}`)).statusCode).toBe(401);
    expect((await admin.browser().get(`/v1/workflows`)).statusCode).toBe(401);
  });

  it("shows the draft once saved", async () => {
    const latest = (await readLatestPublishedDefinition(adminDb, definitionId))!;
    const next = renamed(latest.definition, "Draft shown");
    await engineer.browser.post(`/v1/workflows/${TYPE}/draft`, { definition: next, reason: "Show the draft" });
    const read = (await engineer.browser.get(`/v1/workflows/${TYPE}`)).json();
    expect(read.workflow.draft).toMatchObject({ versionNo: latest.versionNo + 1 });
    expect(read.workflow.draft.definition.steps.find((s: { key: string }) => s.key === "draft").name.en).toBe("Draft shown");
  });

  it("duplicates another Type's Workflow in as this Type's draft, logged with the reason", async () => {
    const mar = (await engineer.browser.get(`/v1/workflows/MAR`)).json();
    const source = mar.workflow.draft?.definition ?? mar.workflow.published.definition;
    const res = await engineer.browser.post(`/v1/workflows/${TYPE}/duplicate`, { fromTypeCode: "MAR", reason: "Start from the MAR" });
    expect(res.statusCode, res.body).toBe(200);
    const read = (await engineer.browser.get(`/v1/workflows/${TYPE}`)).json();
    expect(read.workflow.draft.definition.steps.map((s: { key: string }) => s.key)).toEqual(source.steps.map((s: { key: string }) => s.key));
    expect((await actionsOn(definitionId)).at(-1)).toEqual({ engineer_id: engineer.id, action: "duplicate_workflow", reason: "Start from the MAR" });
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/duplicate`, { fromTypeCode: "NOPE", reason: "x" })).statusCode).toBe(404);
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/duplicate`, { fromTypeCode: "MAR", reason: " " })).statusCode).toBe(400);
  });

  // Decided 2026-10-11 (RP-528 review): every edit of a Rabaed Default set, an addition included, reaches only the Projects created afterwards.
  it("adds an outcome to a Rabaed Default set: existing Projects keep theirs, a Project created afterwards gets it; changes and order leave Projects' copies alone", async () => {
    const existing = await newProject();
    const add = await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes`, {
      code: outcomeCode, name: name("Extra"), closing: true, polarity: "negative", actions: [{ kind: "offer_revision" }], reason: "Add an outcome",
    });
    expect(add.statusCode, add.body).toBe(200);
    expect(await projectCopy(existing, outcomeCode)).toEqual([]);
    const later = await newProject();
    const copies = await projectCopy(later, outcomeCode);
    expect(copies).toEqual([expect.objectContaining({ name: name("Extra"), actions: [{ kind: "offer_revision" }] })]);

    const dup = await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes`, {
      code: outcomeCode, name: name("Again"), closing: true, polarity: "negative", actions: [], reason: "Add twice",
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: "already_exists" });

    const change = await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/${outcomeCode}`, { name: name("Renamed"), actions: [], reason: "Rename it" });
    expect(change.statusCode, change.body).toBe(200);
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/${outcomeCode}`, { name: name("x"), actions: [], closing: false, reason: "Not allowed" })).statusCode).toBe(400);
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/NOPE`, { name: name("x"), actions: [], reason: "Nothing there" })).statusCode).toBe(404);

    const set = (await engineer.browser.get(`/v1/workflows/${TYPE}`)).json().outcomeSet;
    expect(set.find((o: { code: string }) => o.code === outcomeCode)).toMatchObject({ name: name("Renamed"), actions: [] });
    expect(await projectCopy(later, outcomeCode)).toEqual(copies);

    const codes: string[] = set.map((o: { code: string }) => o.code);
    const reordered = [outcomeCode, ...codes.filter((c) => c !== outcomeCode)];
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/order`, { codes: reordered, reason: "Put it first" })).statusCode).toBe(200);
    expect((await engineer.browser.get(`/v1/workflows/${TYPE}`)).json().outcomeSet.map((o: { code: string }) => o.code)).toEqual(reordered);
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/order`, { codes: reordered.slice(1), reason: "Missing one" })).statusCode).toBe(422);
    // One code twice in place of another is not a reorder either: the request schema refuses it, and so does the command itself.
    const repeated = [reordered[0]!, reordered[0]!, ...reordered.slice(2)];
    expect((await engineer.browser.post(`/v1/workflows/${TYPE}/outcomes/order`, { codes: repeated, reason: "Repeated" })).statusCode).toBe(400);
    expect(await reorderDefaultOutcomes(adminDb, engineer.id, TYPE, { codes: repeated, reason: "Repeated" })).toEqual({ ok: false, reason: "invalid_order" });
    expect(await projectCopy(later, outcomeCode)).toEqual(copies);
    expect(await projectCopy(existing, outcomeCode)).toEqual([]);

    const logged = await adminDb
      .selectFrom("admin_action")
      .select(["action", "reason"])
      .where("engineer_id", "=", engineer.id)
      .where("action", "in", ["add_default_outcome", "change_default_outcome", "reorder_default_outcomes"])
      .orderBy("at")
      .execute();
    expect(logged).toEqual([
      { action: "add_default_outcome", reason: "Add an outcome" },
      { action: "change_default_outcome", reason: "Rename it" },
      { action: "reorder_default_outcomes", reason: "Put it first" },
    ]);
  });

  it("adds, renames and reorders a Rabaed Default Stage of a Module: existing Projects keep their sets, a Project created afterwards gets it", async () => {
    const existing = await newProject();
    const add = await engineer.browser.post(`/v1/stages/submittals`, { key: stageKey, name: name("On Hold"), category: "in_progress", reason: "Add a Stage" });
    expect(add.statusCode, add.body).toBe(200);
    expect((await engineer.browser.post(`/v1/stages/submittals`, { key: stageKey, name: name("Again"), category: "in_progress", reason: "Twice" })).statusCode).toBe(409);
    expect((await engineer.browser.post(`/v1/stages/nowhere`, { key: "x_y", name: name("X"), category: "in_progress", reason: "No Module" })).statusCode).toBe(400);
    expect(await projectStage(existing, stageKey)).toEqual([]);

    const later = await newProject();
    const before = await projectStage(later, stageKey);
    expect(before).toEqual([{ name: name("On Hold") }]);

    expect((await engineer.browser.post(`/v1/stages/submittals/${stageKey}`, { name: name("Paused"), reason: "Rename the Stage" })).statusCode).toBe(200);
    expect((await engineer.browser.post(`/v1/stages/submittals/nope`, { name: name("x"), reason: "No such" })).statusCode).toBe(404);
    const stages = (await engineer.browser.get(`/v1/workflows/${TYPE}`)).json().stages;
    expect(stages.find((s: { key: string }) => s.key === stageKey).name).toEqual(name("Paused"));
    expect(await projectStage(later, stageKey)).toEqual(before);

    const keys: string[] = stages.map((s: { key: string }) => s.key);
    const reordered = [stageKey, ...keys.filter((k) => k !== stageKey)];
    expect((await engineer.browser.post(`/v1/stages/submittals/order`, { keys: reordered, reason: "Put it first" })).statusCode).toBe(200);
    expect((await engineer.browser.get(`/v1/workflows/${TYPE}`)).json().stages.map((s: { key: string }) => s.key)).toEqual(reordered);
    expect((await engineer.browser.post(`/v1/stages/submittals/order`, { keys: reordered.slice(1), reason: "Missing one" })).statusCode).toBe(422);
    const repeated = [reordered[0]!, reordered[0]!, ...reordered.slice(2)];
    expect((await engineer.browser.post(`/v1/stages/submittals/order`, { keys: repeated, reason: "Repeated" })).statusCode).toBe(400);
    expect(await reorderDefaultStages(adminDb, engineer.id, "submittals", { keys: repeated, reason: "Repeated" })).toEqual({ ok: false, reason: "invalid_order" });
    expect(await projectStage(later, stageKey)).toEqual(before);
    expect(await projectStage(existing, stageKey)).toEqual([]);

    const logged = await adminDb
      .selectFrom("admin_action")
      .select(["action", "reason"])
      .where("engineer_id", "=", engineer.id)
      .where("action", "in", ["add_default_stage", "rename_default_stage", "reorder_default_stages"])
      .orderBy("at")
      .execute();
    expect(logged.map((l) => l.action)).toEqual(["add_default_stage", "rename_default_stage", "reorder_default_stages"]);
  });

  it("adds one outcome or Stage once when two Engineers add it at the same time: the set's lock lets one check see the other's write", async () => {
    const code = `Y${suffix}`;
    const key = `race_${suffix}`;
    try {
      const outcomes = await Promise.all(
        [1, 2].map((n) =>
          engineer.browser.post(`/v1/workflows/${TYPE}/outcomes`, { code, name: name(`Race ${n}`), closing: true, polarity: "positive", actions: [], reason: `Race ${n}` }),
        ),
      );
      expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const stages = await Promise.all(
        [1, 2].map((n) => engineer.browser.post(`/v1/stages/submittals`, { key, name: name(`Race ${n}`), category: "in_progress", reason: `Race ${n}` })),
      );
      expect(stages.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const rabaed = await migrator
        .selectFrom("outcome")
        .select("code")
        .where("owner_kind", "=", "rabaed")
        .where("code", "=", code)
        .execute();
      expect(rabaed.length).toBe(1);
      expect((await migrator.selectFrom("stage").select("key").where("owner_kind", "=", "rabaed").where("key", "=", key).execute()).length).toBe(1);
    } finally {
      await migrator.deleteFrom("outcome").where("code", "=", code).execute();
      await migrator.deleteFrom("stage").where("key", "=", key).execute();
    }
  });

  it("is reached by a signed-in Rabaed Engineer only, before the body is read", async () => {
    for (const [path, body] of [
      [`/v1/workflows/${TYPE}/duplicate`, { fromTypeCode: 1 }],
      [`/v1/workflows/${TYPE}/outcomes`, { code: 1 }],
      [`/v1/workflows/${TYPE}/outcomes/A`, { name: 1 }],
      [`/v1/workflows/${TYPE}/outcomes/order`, { codes: 1 }],
      [`/v1/stages/submittals`, { key: 1 }],
      [`/v1/stages/submittals/draft`, { name: 1 }],
      [`/v1/stages/submittals/order`, { keys: 1 }],
    ] as const) {
      const res = await admin.browser().post(path, body);
      expect(res.statusCode, path).toBe(401);
      expect(res.json(), path).toEqual({ error: "not_signed_in" });
    }
  });
});
