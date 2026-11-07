// Seam 1 for the Visibility Gap leaving discarded Drafts out (RP-1252; scenario RP-1252-1):
// `GET /v1/projects/:projectId/visibility-gap`. A deactivated Location used only by a discarded Draft
// leaves the gap. The gap stays the Project Admin's only: the 404 that names nothing for everyone else. Seam 2: packages/db/test/rp-1252-visibility-rls.test.ts.
import { expectHiddenFrom, LEGACY_MAR } from "@rabaed/db/test-support";
import type { DimensionValues } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, memberOnProject, ok, only, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let k1: Company;
let c3: Company;
let k1Engineer: { id: string; caller: Caller };

type Viewer = { by: Caller; name: string };
const viewer = (by: Caller, name: string): Viewer => ({ by, name });

const addZone = async (code: string): Promise<string> =>
  (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code, name: bilingual(code), parentId: null }), 201)).json().id;

/** C1's Engineer raises a Draft MAR at `location`; returns the item. */
const draftAt = async (location: string): Promise<string> => {
  const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
    type: LEGACY_MAR,
    title: "Cable tray",
    answers: { manufacturer: "ACME", description: "Galvanised", trade: at.electrical, location },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const gapPath = () => `/v1/projects/${at.projectId}/visibility-gap`;
const gapIds = async (by: Caller) => ((await ok(by.get(gapPath()), 200)).json() as DimensionValues).location.map((v) => v.id);

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c3 = await api.projectCreator();
  at = await buildTower(api, { c1, k1 }, "RGA");
  k1Engineer = await memberOnProject(api, k1, at.k1ParticipantId!, ["engineer"]);
  await api.createProject(c3.caller, { code: "RGO" });
});

// A live or closed item keeping a deactivated value in the gap is seam 2's (rp-1252-visibility-rls.test.ts):
// here C1's grant could not narrow past a live Draft its Engineer holds (409 nobody_can_take).
describe("scenario RP-1252-1: the Visibility Gap counts no discarded Draft as a use of a deactivated value", () => {
  let discarded = "";

  beforeAll(async () => {
    discarded = await addZone("ZX");
    const draft = await draftAt(discarded);
    await ok(at.c1Engineer.post(`/v1/work-items/${draft}/discard-draft`, {}));
    // C1 and K1 cover Building A only, so no Participant covers the Zone.
    for (const p of [at.c1ParticipantId, at.k1ParticipantId!]) {
      await ok(c1.caller.request("PUT", `/v1/participants/${p}/visibility`, { trade: only(at.electrical), location: only(at.buildingA) }));
    }
  });

  it("is the Project Admin's only: the 404 that names nothing for everyone else", async () => {
    const read = async (v: Viewer) => {
      const res = await v.by.get(gapPath());
      if (res.statusCode !== 200) {
        await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
        return [];
      }
      return ((res.json() as DimensionValues).location ?? []).map((value) => ({ id: value.id }));
    };
    await expectHiddenFrom({
      read,
      target: discarded,
      seenBy: viewer(c1.caller, "C1's Authorized Person, the Project Admin"),
      hiddenFrom: [
        viewer(at.c1Engineer, "C1's engineer, who raised the Draft"),
        viewer(k1.caller, "K1's Authorized Person"),
        viewer(k1Engineer.caller, "K1's engineer"),
        viewer(c3.caller, "another Project's Authorized Person and Admin"),
      ],
      name: (v: Viewer) => v.name,
      label: "the Project's Visibility Gap",
    });
  });

  it("drops the Zone once deactivated, as only a discarded Draft uses it", async () => {
    await ok(c1.caller.request("PATCH", `/v1/locations/${discarded}`, { active: false }));
    expect(await gapIds(c1.caller)).not.toContain(discarded); // not hidden-from: the Admin's own gap, which the Zone left (state); the test above read it there first
  });
});
