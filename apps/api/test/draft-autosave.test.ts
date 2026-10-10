// Seam 1 for autosave in Draft, with per-field times (RP-302, spec RP-299;
// form-engine.md §8, "Settled 2026-10-05 (part 3)"): each save stamps the fields
// it changed; a save carrying the times it was based on keeps a field another
// Member changed since as theirs and says who; Draft saves write no
// answers_changed events, and after Draft each button save writes one. Only the
// Member holding the Draft saves it (RP-514).
import type { SavedAnswers, WorkItemHistory } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

let c1: Awaited<ReturnType<typeof api.projectCreator>>;
let engineer: Caller;
let colleague: Caller; // Another Member of the same Participant.
let pm: Caller; // Holds Internal Review.
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const save = (by: Caller, id: string, answers: Record<string, unknown>, basedOn?: Record<string, string>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers }, ...(basedOn ? { basedOn } : {}) });
const times = async (by: Caller, id: string) =>
  Object.fromEntries(Object.entries((await detail(by, id)).fieldTimes).map(([k, v]) => [k, v.at]));
async function diffs(by: Caller, id: string) {
  const events: WorkItemHistory["events"] = (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
  return events.filter((e) => e.type === "answers_changed");
}
const pause = () => new Promise((r) => setTimeout(r, 15));

async function newDraft(answers: Record<string, unknown> = { manufacturer: "ACME" }) {
  const res = await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cable trays", answers: { ...builtIns(), ...answers } }), 201);
  return res.json().id as string;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  colleague = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
});

describe("per-field times", () => {
  it("stamps each field a save changes, and only those", async () => {
    const id = await newDraft({ manufacturer: "ACME", description: "first" });
    const t0 = await times(engineer, id);
    expect(Object.keys(t0).sort()).toEqual(["description", "location", "manufacturer", "trade"]);
    await pause();
    await ok(save(engineer, id, { manufacturer: "ACME", description: "second" }));
    const t1 = await times(engineer, id);
    expect(t1.manufacturer).toBe(t0.manufacturer);
    expect(Date.parse(t1.description!)).toBeGreaterThan(Date.parse(t0.description!));
    await ok(save(engineer, id, { manufacturer: "ACME" }));
    expect(Object.keys(await times(engineer, id)).sort()).toEqual(["location", "manufacturer", "trade"]);
  });

  it("shows them to a Member who may save: the one holding the Draft", async () => {
    const id = await newDraft();
    expect(Object.keys((await detail(engineer, id)).fieldTimes).length).toBeGreaterThan(0);
    expect((await detail(engineer, id)).fieldTimes.manufacturer).toMatchObject({ byMe: true, memberName: { en: "Test Member" } });
    expect((await detail(colleague, id)).fieldTimes).toEqual({});
  });
});

describe("one Draft, saved by its holder only (RP-514)", () => {
  // Two Members never save one Draft at once: the later save would win field by field
  // (ADR 0019). How a save keeps another Member's newer change (after a Handover) is
  // mergeFieldAnswers' (field-times.test.ts).
  it("refuses another Member's save, times or not, and changes nothing", async () => {
    const id = await newDraft({ manufacturer: "ACME", description: "d0" });
    const based = await times(engineer, id);
    for (const res of [await save(colleague, id, { manufacturer: "theirs" }, based), await save(colleague, id, { manufacturer: "theirs" })]) {
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
    }
    expect((await detail(engineer, id)).answers).toMatchObject({ manufacturer: "ACME", description: "d0" });
  });

  it("lets the holder's later save, from an older page, overwrite their own earlier one", async () => {
    const id = await newDraft({ manufacturer: "ACME", description: "d0" });
    const based = await times(engineer, id);
    await pause();
    await ok(save(engineer, id, { manufacturer: "ACME", description: "first tab" }, based), 200);
    const res = await ok(save(engineer, id, { manufacturer: "ACME", description: "second tab" }, based), 200);
    expect((res.json() as SavedAnswers).keptFromOthers).toEqual([]);
    expect((await detail(engineer, id)).answers.description).toBe("second tab");
  });

  it("replaces as it always did when the save carries no times", async () => {
    const id = await newDraft({ manufacturer: "ACME" });
    await ok(save(engineer, id, { manufacturer: "theirs" }));
    await ok(save(engineer, id, { manufacturer: "mine" }));
    expect((await detail(colleague, id)).answers.manufacturer).toBe("mine");
  });
});

describe("history", () => {
  it("writes no answers_changed event for Draft saves, autosave or not, and one per button save after Draft", async () => {
    const id = await newDraft({ manufacturer: "ACME", description: "d0" });
    expect((await detail(engineer, id)).autosave).toBe(true);
    await ok(save(engineer, id, { manufacturer: "ACME", description: "d1" }, await times(engineer, id)), 200);
    await ok(save(engineer, id, { manufacturer: "ACME", description: "d2" }, await times(engineer, id)), 200);
    expect(await diffs(engineer, id)).toEqual([]);
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    // After Draft the web doesn't autosave.
    expect((await detail(engineer, id)).autosave).toBe(false);
    // The PM holding Internal Review doesn't edit the Form (RP-514); Returned, the engineer does.
    await ok(tryTake(pm, id, "return", { reason: "Change the description" }));
    await ok(save(engineer, id, { manufacturer: "ACME", description: "d3" }));
    expect(await diffs(pm, id)).toHaveLength(1);
    await ok(save(engineer, id, { manufacturer: "ACME", description: "d4" }));
    expect(await diffs(pm, id)).toHaveLength(2);
  });
});
