// Seam 1 for the Project Visibility page (RP-1156; visibility.md V15, V16; scenario RP-1156-1). The
// Project's Visibility Gap, `GET /v1/projects/:projectId/visibility-gap`, names the Trades and
// Locations no active Participant covers, to the Project's Project Admins only; it is worked out
// from Participant grants alone, so a Project Member's narrower grant never opens it. Anyone else
// gets the 404 that names nothing. Seam 2: packages/db/test/rp-1156-visibility-rls.test.ts.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { DimensionValues } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, memberOnProject, ok, only, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let k1: Company;
let k1Engineer: { id: string; caller: Caller };

const path = () => `/v1/projects/${at.projectId}/visibility-gap`;
const gap = async (by: Caller) => (await ok(by.get(path()), 200)).json() as DimensionValues;
const ids = (values: DimensionValues) => ({ trade: values.trade.map((v) => v.id), location: values.location.map((v) => v.id) });
const grant = (participantId: string, body: unknown) => ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, body));

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "PVG");
  k1Engineer = await memberOnProject(api, k1, at.k1ParticipantId!, ["engineer"]);
});

describe("scenario RP-1156-1: the Project's Visibility Gap goes to its Project Admins only, from Participant grants alone", () => {
  it("is empty while some active Participant covers every Trade and Location", async () => {
    expect(ids(await gap(c1.caller))).toEqual({ trade: [], location: [] });
  });

  it("names Building A and every Trade but Electrical to the Project Admin once no Participant covers them", async () => {
    await grant(at.c1ParticipantId, { trade: only(at.electrical), location: only() });
    await grant(at.k1ParticipantId!, { trade: only(at.electrical), location: only() });
    const dimensions = (await ok(c1.caller.get(`/v1/projects/${at.projectId}/dimensions`), 200)).json() as DimensionValues;
    const others = dimensions.trade.map((v) => v.id).filter((id) => id !== at.electrical);
    expect(others).toContain(at.mechanical);
    const read = await gap(c1.caller);
    expect({ trade: ids(read).trade.sort(), location: ids(read).location }).toEqual({ trade: others.sort(), location: [at.buildingA] });
    expect(read.location[0]).toMatchObject({ code: "BA", name: { en: "Building A" } });
  });

  it("is not opened by a Project Member's narrower grant", async () => {
    await grant(at.k1ParticipantId!, { trade: all, location: all });
    await ok(k1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/members/${k1Engineer.id}/visibility`, { trade: only(), location: only() }));
    expect(ids(await gap(c1.caller))).toEqual({ trade: [], location: [] });
  });

  it("is the 404 that names nothing for anyone but a Project Admin", async () => {
    await grant(at.k1ParticipantId!, { trade: only(at.electrical), location: only() });
    type Viewer = { by: Caller; name: string };
    const read = async (viewer: Viewer) => {
      const res = await viewer.by.get(path());
      if (res.statusCode !== 200) {
        await expectHidden(res, viewer.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
        return [];
      }
      return (res.json() as DimensionValues).location;
    };
    const viewer = (by: Caller, name: string) => ({ by, name });
    await expectHiddenFrom({
      read,
      target: at.buildingA,
      seenBy: viewer(c1.caller, "C1's Authorized Person, the Project Admin"),
      hiddenFrom: [
        viewer(at.c1Engineer, "C1's engineer"),
        viewer(at.c1Pm, "C1's Project Manager"),
        viewer(k1.caller, "K1's Authorized Person"),
        viewer(at.k1Manager, "K1's manager"),
        viewer(k1Engineer.caller, "K1's engineer"),
      ],
      name: (v: Viewer) => v.name,
      label: "the Project's Visibility Gap",
    });
  });

  it("is the 404 for a made-up Project id, as for a Project the viewer isn't on", async () => {
    await expectHidden(c1.caller.get("/v1/projects/00000000-0000-4000-8000-000000000000/visibility-gap")); // not hidden-from: no such Project, the 404's shape
    await expectHidden(c1.caller.get("/v1/projects/not-an-id/visibility-gap")); // not hidden-from: not an id, the 404's shape
  });
});
