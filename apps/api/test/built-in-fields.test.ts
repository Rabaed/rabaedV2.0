// Seam 1 for the Built-in Fields (RP-270, spec RP-261): Trade, Location and
// Scopes are filled inside the Form, where the MAR Form places them. Trade is
// required even in a Draft, Location to leave Draft; Scopes are those of the
// chosen Trade. The Work Item's Trade and Location, which decide who sees it,
// are the answers to these fields.
import { randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { detail, projectMember } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company; // Contractor; its Authorized Person created the Project.
let engineer: Caller; // C1 Engineer: covers everything, raises MARs.
let electricalOnly: Caller; // C1 Engineer covering Electrical only.
let mechanicalOnly: Caller; // C1 Engineer covering Mechanical only.
let projectId = "";
let own = ""; // C1's Participant.
const trade = { electrical: "", mechanical: "" };
let buildingA = "";
const scope = { lighting: "", indoor: "", power: "", hvac: "" }; // Indoor is a Sub-scope of Lighting; HVAC is Mechanical's.

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]) => ({ isAll: false, valueIds });
const material = { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" };

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const post = async (path: string, body: unknown) =>
  (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;

const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cable trays", answers });

async function created(answers: Record<string, unknown>) {
  return (await ok(createDraft(answers), 201)).json().id as string;
}

const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers });

const sendForReview = (id: string) =>
  engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  trade.electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  trade.mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  scope.lighting = await post("scopes", { tradeId: trade.electrical, name: bilingual("Lighting") });
  scope.indoor = await post("scopes", { tradeId: trade.electrical, parentId: scope.lighting, name: bilingual("Indoor") });
  scope.power = await post("scopes", { tradeId: trade.electrical, name: bilingual("Power") });
  scope.hvac = await post("scopes", { tradeId: trade.mechanical, name: bilingual("HVAC") });
  own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  electricalOnly = await projectMember(api, c1, own, ["engineer"], { trade: only(trade.electrical) });
  mechanicalOnly = await projectMember(api, c1, own, ["engineer"], { trade: only(trade.mechanical) });
  // The internal review's Step Pool, so a Draft can be sent.
  await projectMember(api, c1, own, ["project_manager"]);
});

describe("creating a MAR with its Built-in Fields", () => {
  it("takes Trade, Location and Scopes as answers, and shows them as the item's", async () => {
    const id = await created({ ...material, trade: trade.electrical, location: buildingA, scopes: [scope.lighting, scope.indoor] });
    const d = await detail(engineer, id);
    expect(d.answers).toMatchObject({ trade: trade.electrical, location: buildingA });
    expect([...(d.answers.scopes as string[])].sort()).toEqual([scope.lighting, scope.indoor].sort());
    expect(d).toMatchObject({ trade: { id: trade.electrical, code: "EL" }, location: { id: buildingA, code: "BA" } });
    // Each Scope before its Sub-scopes, with their names.
    expect(d.scopes).toEqual([
      { id: scope.lighting, parentId: null, name: bilingual("Lighting") },
      { id: scope.indoor, parentId: scope.lighting, name: bilingual("Indoor") },
    ]);
  });

  it("refuses a Draft without a Trade, naming the field", async () => {
    const res = await createDraft({ ...material, location: buildingA });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "trade", code: "required" }] });
  });

  it("refuses Scopes outside the chosen Trade, and a Sub-scope without its Scope", async () => {
    for (const scopes of [[scope.hvac], [scope.lighting, scope.hvac], [scope.indoor], [randomUUID()]]) {
      const res = await createDraft({ ...material, trade: trade.electrical, scopes });
      expect(res.statusCode, JSON.stringify(scopes)).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "scopes", code: "unknown_option" }] });
    }
    await ok(createDraft({ ...material, trade: trade.mechanical, scopes: [scope.hvac] }), 201);
  });
});

describe("Save draft with the Built-in Fields", () => {
  let id = "";
  beforeAll(async () => {
    id = await created({ ...material, trade: trade.electrical, scopes: [scope.power] });
  });

  it("refuses removing the Trade, and Scopes with no Trade to be under", async () => {
    const res = await save(id, { ...material, scopes: [scope.power] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "invalid_answers",
      fields: [
        { key: "trade", code: "required" },
        { key: "scopes", code: "unknown_option" },
      ],
    });
  });

  it("refuses a new Trade while Scopes of the old one remain; the Form clears them first", async () => {
    const res = await save(id, { ...material, trade: trade.mechanical, scopes: [scope.power] });
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "scopes", code: "unknown_option" }] });
    expect((await detail(engineer, id)).answers.trade).toBe(trade.electrical);
  });

  it("changes the item's Trade, and so who sees it", async () => {
    expect((await detail(electricalOnly, id)).trade.id).toBe(trade.electrical);
    await expectHidden(mechanicalOnly.get(`/v1/work-items/${id}`));

    await ok(save(id, { ...material, trade: trade.mechanical, scopes: [scope.hvac] }));
    expect(await detail(engineer, id)).toMatchObject({
      trade: { id: trade.mechanical },
      answers: { trade: trade.mechanical, scopes: [scope.hvac] },
      scopes: [{ id: scope.hvac }],
    });
    expect((await detail(mechanicalOnly, id)).trade.id).toBe(trade.mechanical);
    await expectHidden(electricalOnly.get(`/v1/work-items/${id}`));
    await expectHidden(electricalOnly.get(`/v1/work-items/${id}/form`));
  });

  it("refuses a Trade outside the saver's own Visibility", async () => {
    const res = await electricalOnly.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title: "Pumps",
      answers: { trade: trade.mechanical },
    });
    expect(res.json()).toEqual({ error: "outside_visibility" });
  });
});

describe("leaving Draft", () => {
  it("is refused without a Location, naming the field", async () => {
    const id = await created({ ...material, trade: trade.electrical });
    await attachDatasheet(engineer, id);
    const res = await sendForReview(id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "form_incomplete", fields: [{ key: "location", code: "required" }] });
    expect((await detail(engineer, id)).stage.key).toBe("draft");

    await ok(save(id, { ...material, trade: trade.electrical, location: buildingA }));
    await ok(sendForReview(id));
    expect((await detail(engineer, id)).stage.key).toBe("internal_review");
  });
});
