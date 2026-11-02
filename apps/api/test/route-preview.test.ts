// Seam 1 for the New item's route preview (RP-1152, gap rows 22, 34 and 35; V1, V15, V20).
// Before an item exists, its raiser reads the Workflow a new item of the Type would run for
// their Participant (app.new_item_workflow_version, as the create resolves it), the Project's
// Stages of its Module, and the Draft Step's "Drafts visible to". A Workflow is a description
// (V20): the read names no Company and no Member, and a Member who may not raise the Type, or
// isn't on the Project, gets the 404 that names nothing.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { newItemRoutePreview, type NewItemRoutePreview } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, ok, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company; // Contractor; its Authorized Person created the Project.
let k1: Company; // Consultant.
let hafiz: Caller; // C1 Engineer: raises.
let k1Engineer: Caller; // Consultant: holds no Draft, so raises no Submittal.
let outsider: Caller; // C1, not on the Project.
let projectId = "";
let otherProjectId = ""; // C1's other Project, which Hafiz isn't on.
const names = ["Hafiz Preview", "Ali Preview", "Khalid Preview"];

const preview = (by: Caller, type: string, project = projectId) => by.get(`/v1/projects/${project}/work-item-types/${type}/route-preview`);
const read = async (by: Caller, type: string): Promise<NewItemRoutePreview> => newItemRoutePreview.parse((await ok(preview(by, type), 200)).json());

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller)).id;
  otherProjectId = (await api.createProject(c1.caller)).id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  hafiz = await projectMember(api, c1, own, ["engineer"], { name: names[0] });
  await projectMember(api, c1, own, ["project_manager"], { name: names[1] });
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1Participant, ["engineer"], { name: names[2] });
  outsider = (await api.member(c1.caller)).caller;
});

describe("the route preview of a new item", () => {
  it("is the MAR's Workflow for the raiser's Participant, its Steps by role, with the Submittals Stages", async () => {
    const { definition, stages, draftsVisibleTo } = await read(hafiz, "MAR");
    // The MAR runs 2→2 (submittal-2-2.json) while the Project binds no other Workflow.
    expect(definition.steps.map((s) => [s.key, s.actor && "role" in s.actor ? s.actor.role : null])).toEqual([
      ["draft", "contractor"],
      ["internal_review", "contractor"],
      ["contractor_engineer", "contractor"],
      ["consultant_engineer", "consultant"],
      ["consultant_manager", "consultant"],
      ["approved", null],
      ["revise_resubmit", null],
      ["rejected", null],
      ["cancelled", null],
    ]);
    expect(stages.find((s) => s.key === "draft")).toMatchObject({ category: "draft" });
    expect(stages.map((s) => s.key)).toEqual(expect.arrayContaining(["draft", "internal_review", "pending_approval", "approved"]));
    expect(draftsVisibleTo).toBe("company");
  });

  it("gives the Draft Step's Drafts visible to: the author only", async () => {
    await addSendBackType(
      migrator,
      "RPVAO",
      bilingual("Author-only Drafts (route preview test)"),
      {
        sections: [
          {
            key: "classification",
            title: bilingual("Classification"),
            fields: [
              { key: "trade", type: "trade", label: bilingual("Trade") },
              { key: "location", type: "location", label: bilingual("Location") },
              { key: "scopes", type: "scopes", label: bilingual("Scopes") },
            ],
          },
        ],
      },
      { draftsVisibleTo: "author" },
    );
    expect((await read(hafiz, "RPVAO")).draftsVisibleTo).toBe("author");
  });
});

describe("scenario RP-1152-1: the route preview names no Company and no Member", () => {
  it("gives the raiser the Steps, their roles and the Draft Step's setting, and no name or id of anyone", async () => {
    const body = (await ok(preview(hafiz, "MAR"), 200)).body;
    // Every Company here, C1 and K1, has the harness's legal name, and its Authorized Person the harness's name.
    for (const name of ["Test Constructions", "إنشاءات الاختبار", "Test Person", "شخص الاختبار", ...names]) expect(body).not.toContain(name);
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("is the 404 that names nothing for a Member who may not raise the Type: a Consultant, a Type raised only from an item, a Type that isn't one", async () => {
    await expectHidden(preview(k1Engineer, "MAR"));
    await expectHidden(preview(hafiz, "CMT"));
    await expectHidden(preview(hafiz, "NOPE"));
    await expectHidden(preview(hafiz, "not a code"));
  });

  it("is the same 404 off the Member's Projects", async () => {
    await expectHidden(preview(outsider, "MAR"));
    await expectHidden(preview(hafiz, "MAR", otherProjectId));
    await expectHidden(preview(hafiz, "MAR", "not-a-uuid"));
  });
});
