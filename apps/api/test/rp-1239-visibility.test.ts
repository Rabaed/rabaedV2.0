// Seam 1 for renaming and deactivating a Project's Trades and Locations (RP-1239; visibility.md V15,
// V16; scenarios RP-1239-1 to RP-1239-4): `PATCH /v1/trades/:valueId` and `PATCH /v1/locations/:valueId`,
// for the Project's Project Admins only; anyone else gets the 404 that names nothing. A deactivated
// value keeps the Work Items and grants that use it, is never picked anew, and is in the Visibility
// Gap only while a Work Item uses it. Seam 2: packages/db/test/rp-1239-visibility-rls.test.ts.
import { expectHiddenFrom, LEGACY_MAR } from "@rabaed/db/test-support";
import type { DimensionValues } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, memberOnProject, ok, only, submitted, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let k1: Company;
let c3: Company;
let k1Engineer: { id: string; caller: Caller };

type Viewer = { by: Caller; name: string };
const viewer = (by: Caller, name: string): Viewer => ({ by, name });

const patch = (by: Caller, kind: "trades" | "locations", id: string, body: unknown) => by.request("PATCH", `/v1/${kind}/${id}`, body);
const dimensions = async () => (await ok(c1.caller.get(`/v1/projects/${at.projectId}/dimensions`), 200)).json() as DimensionValues;
const valueIn = async (kind: "trade" | "location", id: string) => (await dimensions())[kind].find((v) => v.id === id)!;

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c3 = await api.projectCreator();
  at = await buildTower(api, { c1, k1 }, "RTA");
  k1Engineer = await memberOnProject(api, k1, at.k1ParticipantId!, ["engineer"]);
  await api.createProject(c3.caller, { code: "RTO" });
});

describe("scenario RP-1239-1: only the Project's Project Admins rename or deactivate its Trades and Locations", () => {
  it("lets the Project Admin rename a Trade: the name changes, the code never does", async () => {
    await ok(patch(c1.caller, "trades", at.electrical, { name: { en: "Electrical works", ar: "أعمال كهربائية" } }));
    expect(await valueIn("trade", at.electrical)).toMatchObject({ code: "EL", name: { en: "Electrical works", ar: "أعمال كهربائية" }, active: true });
  });

  it("is the 404 that names nothing for everyone else, and changes nothing", async () => {
    const name = { en: "Renamed", ar: "Renamed" };
    const read = async (v: Viewer) => {
      const res = await patch(v.by, "trades", at.mechanical, v.by === c1.caller ? { name: bilingual("Mechanical") } : { name });
      if (res.statusCode !== 204) {
        await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
        return [];
      }
      return [{ id: at.mechanical }];
    };
    await expectHiddenFrom({
      read,
      target: at.mechanical,
      seenBy: viewer(c1.caller, "C1's Authorized Person, the Project Admin"),
      hiddenFrom: [
        viewer(at.c1Engineer, "C1's engineer"),
        viewer(at.c1Pm, "C1's Project Manager"),
        viewer(k1.caller, "K1's Authorized Person"),
        viewer(at.k1Manager, "K1's manager"),
        viewer(k1Engineer.caller, "K1's engineer"),
        viewer(c3.caller, "another Project's Authorized Person and Admin"),
      ],
      name: (v: Viewer) => v.name,
      label: "renaming a Trade",
    });
    expect((await valueIn("trade", at.mechanical)).name.en).toBe("Mechanical");
    await expectHidden(patch(k1.caller, "locations", at.buildingA, { active: false })); // not hidden-from: a write refused, the 404's shape
    expect((await valueIn("location", at.buildingA)).active).toBe(true);
  });

  it("is the 404 for a value of the other dimension, or a made-up id", async () => {
    await expectHidden(patch(c1.caller, "locations", at.electrical, { name: bilingual("X") })); // not hidden-from: a Trade addressed as a Location
    await expectHidden(patch(c1.caller, "trades", "00000000-0000-4000-8000-000000000000", { name: bilingual("X") })); // not hidden-from: no such value
  });

  it("renames the General Trade but refuses to deactivate it", async () => {
    const gen = (await dimensions()).trade.find((v) => v.code === "GEN")!;
    await ok(patch(c1.caller, "trades", gen.id, { name: { en: "General works", ar: "أعمال عامة" } }));
    const refused = await patch(c1.caller, "trades", gen.id, { active: false });
    expect([refused.statusCode, refused.json().error]).toEqual([409, "general_trade"]);
    expect(await valueIn("trade", gen.id)).toMatchObject({ code: "GEN", active: true, name: { en: "General works" } });
  });

  it("asks for something to change", async () => {
    expect((await patch(c1.caller, "trades", at.electrical, {})).statusCode).toBe(400);
  });
});

describe("scenario RP-1239-2: a deactivated Location keeps its Work Items: nobody loses or gains Visibility", () => {
  let item = "";

  beforeAll(async () => {
    item = await submitted(at, at.c1Engineer, at.c1Pm, "Cable tray, Building A");
    await ok(patch(c1.caller, "locations", at.buildingA, { active: false }));
  });

  it("lists it as deactivated", async () => {
    expect((await valueIn("location", at.buildingA)).active).toBe(false);
  });

  it("leaves the item to K1, who saw it, and to no one it was hidden from", async () => {
    const read = async (v: Viewer) => {
      const res = await v.by.get(`/v1/work-items/${item}`);
      if (res.statusCode !== 200) {
        await expectHidden(res, v.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
        return [];
      }
      return [{ id: (await detail(v.by, item)).id }];
    };
    await expectHiddenFrom({
      read,
      target: item,
      seenBy: viewer(at.k1Manager, "K1's manager"),
      hiddenFrom: [viewer(c3.caller, "another Project's Authorized Person")],
      name: (v: Viewer) => v.name,
      label: "an item on a deactivated Location",
    });
    expect((await detail(at.k1Manager, item)).location?.id).toBe(at.buildingA);
  });
});

describe("scenario RP-1239-3: a deactivated value is never picked anew", () => {
  it("refuses a new Work Item on the deactivated Location", async () => {
    const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: LEGACY_MAR,
      title: "Busbar",
      answers: { manufacturer: "ACME", description: "Copper", trade: at.electrical, location: at.buildingA },
    });
    expect([res.statusCode, res.json().error], res.body).toEqual([422, "value_not_found"]);
  });

  it("refuses a grant that newly lists it, and keeps one that already covers it", async () => {
    const put = (body: unknown) => c1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/visibility`, body);
    await ok(put({ trade: only(at.electrical), location: only(at.buildingA) }));
    await ok(patch(c1.caller, "locations", at.buildingA, { active: true }));
    const zone = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "ZD", name: bilingual("Zone D"), parentId: null }), 201)).json().id;
    await ok(patch(c1.caller, "locations", zone, { active: false }));
    const refused = await put({ trade: only(at.electrical), location: only(at.buildingA, zone) });
    expect([refused.statusCode, refused.json().error]).toEqual([422, "value_not_found"]);
  });
});

describe("scenario RP-1239-4: the Visibility Gap counts a deactivated value only while a Work Item uses it", () => {
  it("drops a deactivated Zone no Work Item uses, and is still the Project Admin's only", async () => {
    const zone = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "ZE", name: bilingual("Zone E"), parentId: null }), 201)).json().id;
    const gap = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}/visibility-gap`), 200)).json() as DimensionValues;
    // K1 covers Building A only (above); C1 now too, so no Participant covers the new Zone.
    await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: only(at.electrical), location: only(at.buildingA) }));
    expect((await gap(c1.caller)).location.map((v) => v.id)).toContain(zone);
    await ok(patch(c1.caller, "locations", zone, { active: false }));
    expect((await gap(c1.caller)).location.map((v) => v.id)).not.toContain(zone);
    await expectHidden(k1.caller.get(`/v1/projects/${at.projectId}/visibility-gap`)); // not hidden-from: RP-1156-1 holds the read; the 404's shape
  });
});
