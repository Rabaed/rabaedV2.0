// Seam 1 for the settings that pick a Trade or Location (RP-1251, a follow-up to RP-1239; visibility.md
// V15; scenarios RP-1251-1 to RP-1251-3): `POST /v1/projects/:projectId/approved-suppliers`, `POST
// /v1/projects/:projectId/checklist-templates`, `PUT /v1/checklist-templates/:templateId` and `PUT
// /v1/projects/:projectId/numbering/counters/start` never take an archived ("deactivated") Trade or
// Location as a new choice; what already has one keeps it and is read as before, by the Project's
// Members only. Everyone but the Project Admin still gets the 404 that names nothing. Seam 2:
// packages/db/test/rp-1251-visibility-rls.test.ts.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { ApprovedSupplier, ChecklistTemplate } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, ok, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let k1: Company;
let c3: Company;
let c3Project = "";
// Trades of the Tower's: one archived after a supplier and a template took it, one archived first.
let kept = "";
let archived = "";
let zone = "";

type Viewer = { by: Caller; name: string };
const viewer = (by: Caller, name: string): Viewer => ({ by, name });

const addValue = async (kind: "trades" | "locations", code: string) =>
  (await ok(c1.caller.post(`/v1/projects/${at.projectId}/${kind}`, { code, name: bilingual(code), ...(kind === "locations" ? { parentId: null } : {}) }), 201)).json().id as string;
const archive = (kind: "trades" | "locations", id: string) => ok(c1.caller.request("PATCH", `/v1/${kind}/${id}`, { active: false }));

const addSupplier = (by: Caller, tradeId: string, en: string) =>
  by.post(`/v1/projects/${at.projectId}/approved-suppliers`, { name: bilingual(en), tradeId, scopeId: null });
const suppliers = async (by: Caller) => {
  const res = await by.get(`/v1/projects/${at.projectId}/approved-suppliers`);
  return res.statusCode === 200 ? (res.json().suppliers as ApprovedSupplier[]) : [];
};

const items = [{ key: "formwork", text: { en: "Formwork tight", ar: "القوالب محكمة" }, answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" }];
const createTemplate = (by: Caller, tradeId: string, en: string) => by.post(`/v1/projects/${at.projectId}/checklist-templates`, { name: bilingual(en), tradeId, items });
const editTemplate = (by: Caller, id: string, tradeId: string, en: string) => by.request("PUT", `/v1/checklist-templates/${id}`, { name: bilingual(en), tradeId, items });

const startCounter = (by: Caller, projectId: string, tradeId: string | null, locationId: string | null) =>
  by.request("PUT", `/v1/projects/${projectId}/numbering/counters/start`, {
    workItemType: "MAR",
    participantId: at.c1ParticipantId,
    tradeId,
    locationId,
    startingNumber: 500,
  });

const refusedAs = async (res: Promise<{ statusCode: number; json: () => { error?: string } }>, error: string) => {
  const r = await res;
  expect([r.statusCode, r.json().error]).toEqual([422, error]);
};

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c3 = await api.projectCreator();
  at = await buildTower(api, { c1, k1 }, "RAA");
  c3Project = (await api.createProject(c3.caller, { code: "RAO" })).id;
  kept = await addValue("trades", "KPT");
  archived = await addValue("trades", "ARC");
  await archive("trades", archived);
  zone = await addValue("locations", "ZAR");
  await archive("locations", zone);
});

const everyoneElse = () => [
  viewer(at.c1Engineer, "C1's engineer"),
  viewer(at.c1Pm, "C1's Project Manager"),
  viewer(k1.caller, "K1's Authorized Person"),
  viewer(at.k1Manager, "K1's manager"),
  viewer(c3.caller, "another Project's Authorized Person and Admin"),
];

describe("scenario RP-1251-1: the Approved Supplier List never takes an archived Trade anew; a supplier on one keeps it", () => {
  let supplier = "";

  beforeAll(async () => {
    supplier = (await ok(addSupplier(c1.caller, kept, "Gulf Steel"), 201)).json().id;
    await archive("trades", kept);
  });

  it("refuses the Project Admin a supplier on an archived Trade, and takes one on an active Trade", async () => {
    await refusedAs(addSupplier(c1.caller, archived, "Red Sea Cement"), "trade_not_found");
    await refusedAs(addSupplier(c1.caller, kept, "Najd Rebar"), "trade_not_found");
    await ok(addSupplier(c1.caller, at.electrical, "Najd Rebar"), 201);
  });

  it("is the 404 that names nothing for everyone else, on an active Trade too", async () => {
    for (const v of everyoneElse()) await expectHidden(addSupplier(v.by, at.electrical, "Hidden Supplies"), v.name); // not hidden-from: a write refused, the 404's shape
  });

  it("keeps the supplier on its archived Trade, listed for the Project's Members and no one else", async () => {
    await expectHiddenFrom({
      read: async (v: Viewer) => (await suppliers(v.by)).filter((s) => s.tradeId === kept),
      target: supplier,
      seenBy: [viewer(c1.caller, "C1's Authorized Person, the Project Admin"), viewer(at.k1Manager, "K1's manager")],
      hiddenFrom: [viewer(c3.caller, "another Project's Authorized Person and Admin")],
      name: (v: Viewer) => v.name,
      label: "a supplier on an archived Trade",
    });
  });
});

describe("scenario RP-1251-2: a Checklist Template never takes an archived Trade anew; one on it keeps it", () => {
  let template = "";
  let ownTrade = "";

  beforeAll(async () => {
    ownTrade = await addValue("trades", "TPL");
    template = (await ok(createTemplate(c1.caller, ownTrade, "Slab checks"), 201)).json().id;
    await archive("trades", ownTrade);
  });

  it("refuses a new template on an archived Trade, and takes one on an active Trade", async () => {
    await refusedAs(createTemplate(c1.caller, archived, "Column checks"), "trade_not_found");
    await ok(createTemplate(c1.caller, at.electrical, "Column checks"), 201);
  });

  it("lets the template keep its own archived Trade on an edit, but never move to another archived one", async () => {
    await ok(editTemplate(c1.caller, template, ownTrade, "Slab checks v2"));
    await refusedAs(editTemplate(c1.caller, template, archived, "Slab checks v3"), "trade_not_found");
    const listed = (await ok(c1.caller.get(`/v1/projects/${at.projectId}/checklist-templates`), 200)).json().templates as ChecklistTemplate[];
    expect(listed.find((x) => x.id === template)).toMatchObject({ tradeId: ownTrade, versionNo: 2 });
  });

  it("is the 404 that names nothing for everyone else, on an active Trade too", async () => {
    for (const v of everyoneElse()) {
      await expectHidden(createTemplate(v.by, at.electrical, "Hidden checks"), v.name); // not hidden-from: a write refused, the 404's shape
      await expectHidden(editTemplate(v.by, template, at.electrical, "Hidden checks"), v.name); // not hidden-from: a write refused, the 404's shape
    }
  });
});

describe("scenario RP-1251-3: a numbering counter's starting number is never set on an archived Trade or Location", () => {
  it("refuses the Project Admin an archived Trade or Location, and takes active ones", async () => {
    await refusedAs(startCounter(c1.caller, at.projectId, archived, null), "value_not_found");
    await refusedAs(startCounter(c1.caller, at.projectId, null, zone), "value_not_found");
    await ok(startCounter(c1.caller, at.projectId, at.electrical, at.buildingA), 200);
  });

  it("is the 404 that names nothing for everyone else, on active values too", async () => {
    for (const v of everyoneElse()) await expectHidden(startCounter(v.by, at.projectId, at.electrical, at.buildingA), v.name); // not hidden-from: a write refused, the 404's shape
    await expectHidden(startCounter(c1.caller, c3Project, null, null), "C1 on another Company's Project"); // not hidden-from: a write refused, the 404's shape
  });
});
