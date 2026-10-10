// Seam 1: the Workflow authoring commands (RP-427, WF-4; spec RP-423; ADR 0016;
// workflow-engine.md §1 "Authoring"; visibility.md V18, V20, scenarios RP-427-1 to
// RP-427-4). A Project Admin duplicates a Workflow into the Project, edits its draft,
// validates and publishes it, and binds a Work Item Type to it, by default or for one
// raising Participant; an Authorized Person copies Workflows to and from the Company
// Library. Every refusal to anyone else is the plain 404.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition, WorkflowRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TOWER_ROUTE = { en: "Tower MAR route", ar: "مسار اعتماد المواد للبرج" };
const C2_LEGAL_NAME = { en: "Gulf Cables Contracting", ar: "مقاولات كابلات الخليج" };

let c1: Company;
let k1: Company;
let at: Tower;
let other: Tower;
let otherAdmin: Company;
let c2Engineer: Caller;
let c2ParticipantId = "";
let c1Member: Caller;
let k1Engineer: Caller;
let marTypeId = "";
let marDefault = "";

const read = async (by: Caller, id: string): Promise<WorkflowRead> => (await ok(by.get(`/v1/workflows/${id}`), 200)).json();

async function duplicate(by: Caller, sourceId: string, projectId: string | null, name = TOWER_ROUTE): Promise<string> {
  const res = await by.post(`/v1/workflows/${sourceId}/duplicate`, { projectId, name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

const bind = (by: Caller, projectId: string, workflowId: string, raisingParticipantId: string | null = null) =>
  by.request("PUT", `/v1/projects/${projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId, workflowId });

/** The MAR's Draft Step renamed, a change a draft can carry. */
function renamedDraftStep(definition: WorkflowDefinition, en: string): WorkflowDefinition {
  return { ...definition, steps: definition.steps.map((s) => (s.stage === "draft" ? { ...s, name: { en, ar: en } } : s)) };
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WFA");
  otherAdmin = await api.projectCreator();
  other = await buildTower(api, { c1: otherAdmin, k1: await api.authorizedPerson() }, "WFO");
  const c2Company = await api.onboardCompany({ legalName: C2_LEGAL_NAME });
  const c2: Company = { company: c2Company, caller: await api.acceptInvitation(c2Company.invitationToken) };
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c1Member = at.c1Engineer;
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean; id: string }) => !p.isOwnCompany && p.id !== c2ParticipantId).id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  marDefault = mar.rows[0]!.workflow_definition_id;
});

describe("a Project Admin authors the Project's own Workflow", () => {
  let route = "";

  it("duplicates the Rabaed Default into the Project as an independent draft", async () => {
    route = await duplicate(c1.caller, marDefault, at.projectId);
    const copy = await read(c1.caller, route);
    const original = await read(c1.caller, marDefault);
    expect(copy).toMatchObject({ name: TOWER_ROUTE, owner: "project", projectId: at.projectId, workItemTypeId: marTypeId });
    expect(copy.publishedVersions).toEqual([]);
    expect(copy.draft).toEqual({ versionNo: 1, name: TOWER_ROUTE, definition: original.published!.definition });
    expect(copy.canAuthor).toBe(true);
  });

  it("saves an edited draft, and only its authors read it (scenario RP-427-3)", async () => {
    const definition = renamedDraftStep((await read(c1.caller, route)).draft!.definition, "Prepare");
    const res = await c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition });
    expect(res.statusCode, res.body).toBe(200);
    expect((await read(c1.caller, route)).draft).toEqual({ versionNo: 1, name: TOWER_ROUTE, definition });
    // Never published, it is read by its authors only: its name is the draft's (scenario RP-427-5).
    for (const reader of [c1Member, k1Engineer, c2Engineer]) {
      await expectHidden(reader.get(`/v1/workflows/${route}`));
    }
  });

  it("keeps a Transition's rules, actions and notifications in the draft (WF-7 to WF-9)", async () => {
    const saved = (await read(c1.caller, route)).draft!.definition;
    const [first, ...rest] = saved.transitions;
    const definition: WorkflowDefinition = {
      ...saved,
      transitions: [
        {
          ...first!,
          rules: { validate: [{ type: "form_complete" }] },
          actions: [{ type: "offer_assign_to" }],
          notifications: [{ to: "raiser" }],
        },
        ...rest,
      ],
    };
    const res = await c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition });
    expect(res.statusCode, res.body).toBe(200);
    expect((await read(c1.caller, route)).draft!.definition).toEqual(definition);
    // Back to the draft the next tests start from.
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: saved }), 200);
    expect((await read(c1.caller, route)).draft!.definition).toEqual(saved);
  });

  it("refuses a draft that isn't a definition, saying where", async () => {
    const res = await c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: { steps: [], transitions: [] } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "invalid_definition", issues: [{ path: "layout" }] });
  });

  it("validates a definition with every publish problem, in English and Arabic, saving nothing", async () => {
    const saved = (await read(c1.caller, route)).draft!.definition;
    const broken = { ...saved, transitions: saved.transitions.filter((t) => t.key !== "send_for_review") };
    const res = await c1.caller.post(`/v1/workflows/${route}/validate`, { definition: broken });
    expect(res.statusCode, res.body).toBe(200);
    const { issues, problems } = res.json();
    expect(issues).toEqual([]);
    expect(problems).toContainEqual(expect.objectContaining({ code: "dead_end_step", step: "draft", severity: "error" }));
    expect(problems[0].message.ar).not.toEqual("");
    expect((await read(c1.caller, route)).draft!.definition).toEqual(saved);
    const ofSaved = await ok(c1.caller.post(`/v1/workflows/${route}/validate`, {}), 200);
    expect(ofSaved.json()).toEqual({ issues: [], problems: [] });
  });

  it("refuses to publish a draft with an error, and publishes it once it has none", async () => {
    const saved = (await read(c1.caller, route)).draft!.definition;
    const broken = { ...saved, transitions: saved.transitions.filter((t) => t.key !== "send_for_review") };
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: broken }), 200);
    const refused = await c1.caller.post(`/v1/workflows/${route}/publish`);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: "workflow_problems", problems: expect.arrayContaining([expect.objectContaining({ code: "dead_end_step" })]) });
    expect((await read(c1.caller, route)).publishedVersions).toEqual([]);

    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: saved }), 200);
    const published = await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    expect(published.json()).toMatchObject({ versionNo: 1 });
    const asMember = await read(k1Engineer, route);
    expect(asMember).toMatchObject({ publishedVersions: [1], published: { versionNo: 1, definition: saved }, draft: null });
    expect(await read(c1.caller, route)).toMatchObject({ draft: null });
  });

  it("binds the MAR to it: new items run it, earlier ones keep theirs", async () => {
    const before = await draft(at, at.c1Engineer, "Before the binding");
    await ok(bind(c1.caller, at.projectId, route));
    const after = await draft(at, at.c1Engineer, "After the binding");
    expect((await detail(at.c1Engineer, after)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 1 });
    expect((await detail(at.c1Engineer, before)).workflow.name.en).toBe("Material Submittal (MAR)");
    expect((await detail(at.c1Engineer, after)).step.name.en).toBe("Prepare");
  });

  it("publishes a second Version from a new draft, for items created after it", async () => {
    const definition = renamedDraftStep((await read(c1.caller, route)).published!.definition, "Prepare v2");
    const saved = await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition }), 200);
    expect(saved.json()).toEqual({ versionNo: 2 });
    const onV1 = await draft(at, at.c1Engineer, "Still on Version 1");
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    const onV2 = await draft(at, at.c1Engineer, "On Version 2");
    expect((await detail(at.c1Engineer, onV2)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 2 });
    expect((await detail(at.c1Engineer, onV1)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 1 });
  });

  it("keeps a draft's new name with the draft: items and Members read the published name until it is published (scenario RP-427-5)", async () => {
    const renamedTo = { en: "Tower MAR route, renamed", ar: "مسار البرج المعدل" };
    const definition = (await read(c1.caller, route)).published!.definition;
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { name: renamedTo, definition }), 200);
    const id = await draft(at, at.c1Engineer, "While the rename is a draft");
    expect((await detail(at.c1Engineer, id)).workflow.name).toEqual(TOWER_ROUTE);
    expect((await read(k1Engineer, route)).name).toEqual(TOWER_ROUTE);
    expect(await read(c1.caller, route)).toMatchObject({ name: TOWER_ROUTE, draft: { versionNo: 3, name: renamedTo } });
    // Saved back under its name, the draft renames nothing.
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { name: TOWER_ROUTE, definition }), 200);
  });

  it("unbinds: new items run the Rabaed Default again", async () => {
    const res = await c1.caller.delete(`/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}`);
    expect(res.statusCode, res.body).toBe(204);
    const id = await draft(at, at.c1Engineer, "Unbound");
    expect((await detail(at.c1Engineer, id)).workflow.name.en).toBe("Material Submittal (MAR)");
    await ok(bind(c1.caller, at.projectId, route));
  });
});

describe("copying a Workflow into a Project maps its Stages by key (WF-5)", () => {
  it("is refused, naming the Stage and a Step in it in English and Arabic, when the Project's Module lacks one", async () => {
    // A Project Workflow whose Consultant review is in a Stage only that Project has.
    await ok(
      c1.caller.post(`/v1/projects/${at.projectId}/modules/submittals/stages`, {
        key: "on_hold",
        name: { en: "On Hold", ar: "معلّق" },
        category: "in_progress",
      }),
      201,
    );
    const held = await duplicate(c1.caller, marDefault, at.projectId, { en: "Held route", ar: "مسار معلّق" });
    const saved = (await read(c1.caller, held)).draft!.definition;
    const definition = { ...saved, steps: saved.steps.map((s) => (s.stage === "pending_approval" ? { ...s, stage: "on_hold" } : s)) };
    await ok(c1.caller.request("PUT", `/v1/workflows/${held}/draft`, { definition }), 200);
    await ok(c1.caller.post(`/v1/workflows/${held}/publish`), 200);
    const step = definition.steps.find((s) => s.stage === "on_hold")!;

    const third = await buildTower(api, { c1, k1 }, "WFS");
    const res = await c1.caller.post(`/v1/workflows/${held}/duplicate`, { projectId: third.projectId, name: { en: "Copy", ar: "نسخة" } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toEqual({
      error: "stage_missing",
      problems: [
        {
          code: "stage_missing",
          stage: "on_hold",
          step: step.key,
          message: {
            en: `This Project has no Stage "on_hold" (used by ${step.name.en}). Add it in the Project's Stages first.`,
            ar: `لا توجد في هذا المشروع مرحلة "on_hold" (تستخدمها الخطوة ${step.name.ar}). أضفها أولاً في مراحل المشروع.`,
          },
        },
      ],
    });
    // Nothing was copied; once the Project has the Stage, the copy goes ahead.
    await ok(
      c1.caller.post(`/v1/projects/${third.projectId}/modules/submittals/stages`, {
        key: "on_hold",
        name: { en: "On Hold", ar: "معلّق" },
        category: "in_progress",
      }),
      201,
    );
    await duplicate(c1.caller, held, third.projectId, { en: "Copy", ar: "نسخة" });
  });
});

describe("scenario RP-427-4: an exception's Workflow never names its Participant", () => {
  it("refuses to bind C2's exception to a Workflow named after C2, and binds it once renamed", async () => {
    const named = await duplicate(c1.caller, marDefault, at.projectId, { en: "Gulf Cables Contracting MARs", ar: "طلبات المقاول" });
    await ok(c1.caller.post(`/v1/workflows/${named}/publish`), 200);
    const refused = await bind(c1.caller, at.projectId, named, c2ParticipantId);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "workflow_name_names_participant" });

    const definition = (await read(c1.caller, named)).published!.definition;
    await ok(c1.caller.request("PUT", `/v1/workflows/${named}/draft`, { name: { en: "MARs, short route", ar: "مسار مختصر" }, definition }), 200);
    await ok(c1.caller.post(`/v1/workflows/${named}/publish`), 200);
    await ok(bind(c1.caller, at.projectId, named, c2ParticipantId));
    const c2Item = await draft(at, c2Engineer, "C2's MAR");
    expect((await detail(c2Engineer, c2Item)).workflow).toEqual({ name: { en: "MARs, short route", ar: "مسار مختصر" }, versionNo: 2 });

    // Bound as an exception, it can't be renamed after C2 either.
    const renamed = await c1.caller.request("PUT", `/v1/workflows/${named}/draft`, { name: C2_LEGAL_NAME, definition });
    expect(renamed.statusCode).toBe(422);
    expect(renamed.json()).toEqual({ error: "workflow_name_names_participant" });
  });
});

describe("scenario RP-427-1: nobody but the Project Admin changes the Project's Workflows", () => {
  let route = "";
  beforeAll(async () => {
    route = await duplicate(c1.caller, marDefault, at.projectId, { en: "Kept route", ar: "مسار محفوظ" });
  });

  it("a C1 Member, K1's Authorized Person and another Project's Admin get 404 for every command", async () => {
    const definition = (await read(c1.caller, marDefault)).published!.definition;
    for (const [who, by] of [
      ["C1 member", c1Member],
      ["K1 Authorized Person", k1.caller],
      ["another Project's Admin", otherAdmin.caller],
    ] as const) {
      await expectHidden(by.post(`/v1/workflows/${marDefault}/duplicate`, { projectId: at.projectId, name: TOWER_ROUTE }), `${who} duplicates`);
      await expectHidden(by.request("PUT", `/v1/workflows/${route}/draft`, { definition }), `${who} saves`);
      await expectHidden(by.post(`/v1/workflows/${route}/validate`, {}), `${who} validates`);
      await expectHidden(by.post(`/v1/workflows/${route}/publish`), `${who} publishes`);
      await expectHidden(bind(by, at.projectId, marDefault), `${who} binds`);
      await expectHidden(by.delete(`/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}`), `${who} unbinds`);
    }
    expect((await read(c1.caller, route)).draft?.versionNo).toBe(1);
  });

  it("a Rabaed Default is changed by nobody through the api", async () => {
    const definition = (await read(c1.caller, marDefault)).published!.definition;
    await expectHidden(c1.caller.request("PUT", `/v1/workflows/${marDefault}/draft`, { definition }));
    await expectHidden(c1.caller.post(`/v1/workflows/${marDefault}/publish`));
  });

  it("a made-up Workflow, and a malformed id, are the same 404", async () => {
    await expectHidden(c1.caller.get(`/v1/workflows/${crypto.randomUUID()}`));
    await expectHidden(c1.caller.get(`/v1/workflows/not-an-id`));
    await expectHidden(c1.caller.post(`/v1/workflows/${crypto.randomUUID()}/publish`));
  });
});

describe("scenario RP-427-2: a binding names the Project's own Workflow or a Rabaed Default", () => {
  it("binding another Project's Workflow, or a Library's, is the same 404 as a made-up one", async () => {
    const otherRoute = await duplicate(otherAdmin.caller, marDefault, other.projectId, { en: "Other route", ar: "مسار آخر" });
    await ok(otherAdmin.caller.post(`/v1/workflows/${otherRoute}/publish`), 200);
    await expectHidden(bind(c1.caller, at.projectId, otherRoute));
    const library = await duplicate(c1.caller, marDefault, null, { en: "C1 Library MAR", ar: "مسار المكتبة" });
    await expectHidden(bind(c1.caller, at.projectId, library));
    await expectHidden(bind(c1.caller, at.projectId, crypto.randomUUID()));
  });

  it("a Workflow of the Project not yet published is refused as such", async () => {
    const unpublished = await duplicate(c1.caller, marDefault, at.projectId, { en: "Not yet", ar: "ليس بعد" });
    const res = await bind(c1.caller, at.projectId, unpublished);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "workflow_not_published" });
  });
});

describe("the Company Library (V18)", () => {
  it("K1's Authorized Person copies the Tower's Workflow into K1's Library, then into another Project", async () => {
    const towerRoute = (await sql<{ id: string }>`
      select id from workflow_definition where project_id = ${at.projectId}::uuid and name ->> 'en' = 'Tower MAR route'
    `.execute(migrator)).rows[0]!.id;
    // K1's Authorized Person isn't on the Tower: a Project Member of K1 reads the Workflow, its Authorized Person doesn't.
    await expectHidden(k1.caller.post(`/v1/workflows/${towerRoute}/duplicate`, { projectId: null, name: TOWER_ROUTE }));
    await api.addProjectMember(k1.caller, (await k1ParticipantOf(at)), k1.company.authorizedPerson.id);
    const library = await duplicate(k1.caller, towerRoute, null, { en: "K1 review route", ar: "مسار مراجعة الاستشاري" });
    expect(await read(k1.caller, library)).toMatchObject({ owner: "company", draft: { versionNo: 1 }, canAuthor: true });
    await ok(k1.caller.post(`/v1/workflows/${library}/publish`), 200);
    // Nobody outside K1 reads it: not C1's Project Admin, not K1's Project's Members of other Companies.
    await expectHidden(c1.caller.get(`/v1/workflows/${library}`));
    await expectHidden(c2Engineer.get(`/v1/workflows/${library}`));
    // A K1 Member who isn't the Authorized Person reads it, but doesn't change it.
    expect(await read(k1Engineer, library)).toMatchObject({ canAuthor: false, draft: null, publishedVersions: [1] });
    await expectHidden(k1Engineer.post(`/v1/workflows/${library}/publish`));
  });
});

describe("a Revision starts on its chain's own Workflow (ADR 0016)", () => {
  it("a Code C item's Revision starts on the Workflow it ran, though the Project binds another since", async () => {
    // The Tower binds its route; an item on it gets Code C.
    const id = await draft(at, at.c1Engineer, "Revised on its own route");
    expect((await detail(at.c1Engineer, id)).workflow.name).toEqual(TOWER_ROUTE);
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    const answers = { ...(await detail(k1Engineer, id)).answers, sample_checked: true, matches_specification: false, verification_note: "Below spec" };
    await ok(k1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, "revise_c", { remarks: "Resubmit with the datasheet" });
    // The Project goes back to the Rabaed Default.
    await ok(c1.caller.delete(`/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}`), 204);
    const revision = await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: crypto.randomUUID() }), 201);
    expect((await detail(at.c1Engineer, revision.json().id)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 2 });
  });
});

async function k1ParticipantOf(tower: Tower): Promise<string> {
  return (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean; id: string }) => !p.isOwnCompany && p.id !== c2ParticipantId).id;
}
