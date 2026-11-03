// Seam 1 for the New Inspection's route preview (RP-1221, gap rows 23 and 24; V1, V15, V20).
// Before a WIR exists, its raiser reads the WIR Workflow a new one would run for their
// Participant, as RP-1152's read gives any Type: its Steps by role, the Inspections Stages, and
// the Draft Step's "Drafts visible to". It names no Company and no Member: not the Contractor PM
// who will review it, not the Consultant who will inspect it. A Member who may not raise a WIR
// gets the 404 that names nothing.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { newItemRoutePreview, type NewItemRoutePreview } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, ok, projectMember } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let raiser: Caller; // C1 Engineer: raises the WIR.
let k1Engineer: Caller; // Consultant: inspects, raises no WIR.
let outsider: Caller; // C1, not on the Project.
let projectId = "";
const names = ["Hafiz Inspection", "Ali Inspection", "Khalid Inspection"];

const preview = (by: Caller) => by.get(`/v1/projects/${projectId}/work-item-types/WIR/route-preview`);
const read = async (by: Caller): Promise<NewItemRoutePreview> => newItemRoutePreview.parse((await ok(preview(by), 200)).json());

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller)).id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  raiser = await projectMember(api, c1, own, ["engineer"], { name: names[0] });
  await projectMember(api, c1, own, ["project_manager"], { name: names[1] });
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1Participant, ["engineer"], { name: names[2] });
  outsider = (await api.member(c1.caller)).caller;
});

describe("the route preview of a new WIR", () => {
  it("is the WIR Workflow by role: the Contractor's Draft and review, the Consultant's inspection, then the Review Code's outcomes", async () => {
    const { definition, stages, draftsVisibleTo } = await read(raiser);
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
    expect(draftsVisibleTo).toBe("company");
  });
});

describe("scenario RP-1221-1: the New Inspection's route preview names no Company and no Member", () => {
  type Viewer = { by: () => Caller; name: string };
  const previewRead = async (viewer: Viewer) => {
    const res = await preview(viewer.by());
    if (res.statusCode === 200) return [{ id: "WIR" }];
    await expectHidden(res, viewer.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
    return [];
  };

  it("gives the raiser the Steps and their roles, and no name or id of anyone", async () => {
    const body = (await ok(preview(raiser), 200)).body;
    expect(newItemRoutePreview.parse(JSON.parse(body)).definition.steps.length).toBeGreaterThan(0);
    // Every Company here, C1 and K1, has the harness's legal name, and its Authorized Person the harness's name.
    for (const name of ["Test Constructions", "إنشاءات الاختبار", "Test Person", "شخص الاختبار", ...names]) expect(body).not.toContain(name); // not hidden-from: the preview read just above, with its Steps
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); // not hidden-from: the same preview, holding no id
  });

  it("is the 404 that names nothing for the Consultant, who raises no WIR, and for a Member off the Project", async () => {
    await expectHiddenFrom({
      read: previewRead,
      target: "WIR",
      seenBy: { by: () => raiser, name: "C1's engineer" },
      hiddenFrom: [
        { by: () => k1Engineer, name: "K1's engineer, who inspects and raises no WIR" },
        { by: () => outsider, name: "a C1 Member off the Project" },
      ],
      name: (v: Viewer) => v.name,
      label: "the WIR's route preview",
    });
  });
});
