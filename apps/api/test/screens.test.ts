// Seam 1 for Screens (RP-516; ADR 0019; workflow-engine.md §5.7; visibility.md V5, V20,
// scenario RP-516-1). A Project Admin creates, versions and publishes a Screen: a reply's
// Action Form whose fields are each shared or internal to the acting Participant. Every
// Project Member reads the published Screens, nobody else, and a draft only its authors.
// A Workflow's Transition names the Screen; publishing the Workflow pins the Screen's
// Version, so a new Screen Version never changes an item running on the old one. Shared
// answers are read by everyone who sees the item from that Transition on, internal ones
// by the acting Participant only, in the history too (seam 2: screens-rls.test.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type ScreenList, type ScreenRead, type WorkflowDefinition, type WorkflowRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "SCRNS";
const label = (en: string) => ({ en, ar: en });

/** The Consultant's Code reply: the Remarks shared, the verification note internal to the Consultant. */
const codeReplyV1 = {
  sections: [
    {
      key: "reply",
      title: label("Reply"),
      fields: [
        { key: "remarks", type: "textarea", label: label("Remarks") },
        { key: "verification_note", type: "textarea", label: label("Verification note") },
      ],
    },
  ],
};
/** Version 2: the Remarks required, and a checklist (no photos). */
const codeReplyV2 = {
  sections: [
    {
      key: "reply",
      title: label("Reply"),
      fields: [
        { key: "remarks", type: "textarea", required: true, label: label("Remarks") },
        { key: "verification_note", type: "textarea", label: label("Verification note") },
        { key: "checks", type: "checklist", label: label("Checks"), items: [{ key: "sample", text: label("Sample checked"), answers: "yes_no_na" }] },
      ],
    },
  ],
};

let c1: Company;
let k1: Company;
let at: Tower;
let other: Tower;
let k1Engineer: Caller;
let screenId = "";
let routeId = "";

const readScreen = async (by: Caller, id: string): Promise<ScreenRead> => (await ok(by.get(`/v1/screens/${id}`), 200)).json();
const readWorkflow = async (by: Caller, id: string): Promise<WorkflowRead> => (await ok(by.get(`/v1/workflows/${id}`), 200)).json();

async function raise(title: string): Promise<string> {
  const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
    type: TYPE,
    title,
    answers: { model: title, trade: at.electrical, location: at.buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

/** An item raised and moved to the K1 manager's Code Step. */
async function atApproval(title: string): Promise<string> {
  const id = await raise(title);
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_to_manager");
  return id;
}

const approveForm = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.find((t) => t.key === "approve_a")?.actionForm;

type HistoryEvent = { type: string; answers: Record<string, unknown> | null; internalNote: string | null };
const history = async (by: Caller, id: string): Promise<HistoryEvent[]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;

beforeAll(async () => {
  const form = {
    sections: [
      { key: "material", title: label("Material"), fields: [{ key: "model", type: "text", label: label("Model") }] },
      {
        key: "classification",
        title: label("Classification"),
        fields: [
          { key: "trade", type: "trade", label: label("Trade") },
          { key: "location", type: "location", label: label("Location") },
          { key: "scopes", type: "scopes", label: label("Scopes") },
        ],
      },
    ],
  };
  await addSendBackType(migrator, TYPE, { en: "Screened submittal", ar: "تقديم بشاشات" }, form);
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SCR");
  other = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "SCO");
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
});

describe("a Project Admin authors the Project's Screens", () => {
  it("creates a Screen as a draft that only its authors read", async () => {
    const res = await c1.caller.post(`/v1/projects/${at.projectId}/screens`, {
      key: "code_reply",
      name: { en: "Code reply", ar: "رد الرمز" },
      schema: codeReplyV1,
      internalFields: ["verification_note"],
    });
    expect(res.statusCode, res.body).toBe(201);
    screenId = res.json().id;
    expect(await readScreen(c1.caller, screenId)).toMatchObject({
      key: "code_reply",
      owner: "project",
      projectId: at.projectId,
      publishedVersions: [],
      published: null,
      draft: { versionNo: 1, schema: codeReplyV1, internalFields: ["verification_note"] },
      canAuthor: true,
    });
    for (const reader of [at.c1Engineer, at.k1Manager, other.c1Engineer]) await expectHidden(reader.get(`/v1/screens/${screenId}`));
  });

  it("is refused to anyone but the Project's Project Admins, like a made-up Project; and a key taken twice", async () => {
    const body = { key: "other_reply", name: label("Other"), schema: codeReplyV1, internalFields: [] };
    for (const by of [at.c1Engineer, at.k1Manager, other.c1Engineer]) await expectHidden(by.post(`/v1/projects/${at.projectId}/screens`, body));
    const again = await c1.caller.post(`/v1/projects/${at.projectId}/screens`, { ...body, key: "code_reply" });
    expect({ status: again.statusCode, error: again.json().error }).toEqual({ status: 409, error: "key_taken" });
  });

  it("refuses to publish a draft with a problem, naming each", async () => {
    await ok(c1.caller.request("PUT", `/v1/screens/${screenId}/draft`, { schema: codeReplyV1, internalFields: ["recommended"] }), 200);
    const res = await c1.caller.post(`/v1/screens/${screenId}/publish`);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: "screen_problems", problems: [{ key: "recommended", code: "unknown_internal_field" }] });
  });

  it("publishes it: every Project Member reads it, never another Project's (V20)", async () => {
    await ok(c1.caller.request("PUT", `/v1/screens/${screenId}/draft`, { schema: codeReplyV1, internalFields: ["verification_note"] }), 200);
    expect((await ok(c1.caller.post(`/v1/screens/${screenId}/publish`), 200)).json()).toEqual({ versionNo: 1 });
    for (const reader of [at.c1Engineer, at.k1Manager]) {
      expect(await readScreen(reader, screenId)).toMatchObject({
        publishedVersions: [1],
        published: { versionNo: 1, schema: codeReplyV1, internalFields: ["verification_note"] },
        draft: null,
        canAuthor: false,
      });
      const list: ScreenList = (await ok(reader.get(`/v1/projects/${at.projectId}/screens`), 200)).json();
      expect(list.screens).toContainEqual({ id: screenId, key: "code_reply", name: { en: "Code reply", ar: "رد الرمز" }, owner: "project", latestVersionNo: 1 });
    }
    await expectHidden(other.c1Engineer.get(`/v1/screens/${screenId}`));
    const others: ScreenList = (await ok(other.c1Engineer.get(`/v1/projects/${other.projectId}/screens`), 200)).json();
    expect(others.screens.map((s) => s.id)).not.toContain(screenId);
    await expectHidden(other.c1Engineer.get(`/v1/projects/${at.projectId}/screens`));
  });
});

describe("a Transition shows a Screen, pinned by the Workflow Version", () => {
  /** The Project's copy of the Type's Workflow, its Code A showing `screen`, published and bound. */
  async function publishRoute(screen: string) {
    const definition = (await readWorkflow(c1.caller, routeId)).draft?.definition ?? (await readWorkflow(c1.caller, routeId)).published!.definition;
    const withScreen: WorkflowDefinition = {
      ...definition,
      transitions: definition.transitions.map((t) => (t.key === "approve_a" ? { ...t, actionForm: null, screen } : t)),
    };
    await ok(c1.caller.request("PUT", `/v1/workflows/${routeId}/draft`, { definition: withScreen }), 200);
    return c1.caller.post(`/v1/workflows/${routeId}/publish`);
  }

  beforeAll(async () => {
    const type = await sql<{ id: string; workflow_definition_id: string }>`
      select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${TYPE}
    `.execute(migrator);
    const res = await c1.caller.post(`/v1/workflows/${type.rows[0]!.workflow_definition_id}/duplicate`, { projectId: at.projectId, name: label("Screened route") });
    expect(res.statusCode, res.body).toBe(201);
    routeId = res.json().id;
    const published = await publishRoute("code_reply");
    expect(published.statusCode, published.body).toBe(200);
    await ok(
      c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, {
        workItemTypeId: type.rows[0]!.id,
        raisingParticipantId: null,
        workflowId: routeId,
      }),
    );
  });

  it("refuses to publish a Workflow showing a Screen the Project doesn't have", async () => {
    const res = await publishRoute("missing_reply");
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().problems).toContainEqual(expect.objectContaining({ code: "screen_not_found", transition: "approve_a" }));
    expect((await publishRoute("code_reply")).statusCode).toBe(200);
  });

  it("reads the Screen in the Workflow, by its key", async () => {
    const read = await readWorkflow(at.k1Manager, routeId);
    expect(read.published!.definition.transitions.find((t) => t.key === "approve_a")).toMatchObject({ screen: "code_reply", actionForm: null });
  });

  it("offers the pinned Screen Version's Action Form, which a new Screen Version doesn't change", async () => {
    const running = await atApproval("Pinned");
    expect(await approveForm(at.k1Manager, running)).toEqual(formSchema.parse(codeReplyV1));

    await ok(c1.caller.request("PUT", `/v1/screens/${screenId}/draft`, { schema: codeReplyV2, internalFields: ["verification_note", "checks"] }), 200);
    expect((await ok(c1.caller.post(`/v1/screens/${screenId}/publish`), 200)).json()).toEqual({ versionNo: 2 });
    expect(await approveForm(at.k1Manager, running)).toEqual(formSchema.parse(codeReplyV1));
    // Taken without the Remarks Version 2 requires: Version 1 doesn't.
    await take(at.k1Manager, running, "approve_a", { answers: { verification_note: "Checked" } });

    // The Workflow published again pins Version 2, for new items only.
    expect((await publishRoute("code_reply")).statusCode).toBe(200);
    const fresh = await atApproval("Fresh");
    expect(await approveForm(at.k1Manager, fresh)).toEqual(formSchema.parse(codeReplyV2));
  });

  it("gives the Code's shared answers to everyone who sees the item, its internal ones to the Consultant only (scenario RP-516-1)", async () => {
    const id = await atApproval("Replied");
    await take(at.k1Manager, id, "approve_a", {
      answers: { remarks: "Matches the approved sample.", verification_note: "Batch 7 checked at the plant.", checks: { sample: { answer: "yes" } } },
      internalNote: "Recommended A after the plant visit.",
    });

    for (const contractor of [at.c1Pm, at.c1Engineer]) {
      const events = await history(contractor, id);
      const code = events.find((e) => e.type === "issue_code");
      expect(code?.answers).toEqual({ remarks: "Matches the approved sample." });
      expect(events.map((e) => e.type)).not.toContain("internal_answers");
      expect(events.map((e) => e.type)).not.toContain("internal_note");
      const everything = JSON.stringify([events, await detail(contractor, id)]);
      expect(everything).not.toContain("Batch 7");
      expect(everything).not.toContain("plant visit");
    }

    const own = await history(at.k1Manager, id);
    expect(own.find((e) => e.type === "issue_code")?.answers).toEqual({ remarks: "Matches the approved sample." });
    expect(own.find((e) => e.type === "internal_answers")?.answers).toEqual({
      verification_note: "Batch 7 checked at the plant.",
      checks: { sample: { answer: "yes" } },
    });
    expect(own.find((e) => e.type === "internal_note")?.internalNote).toBe("Recommended A after the plant visit.");
  });
});
