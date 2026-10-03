// Seam 1 for the Form engine's tracer (RP-262, spec RP-261): a Contractor
// Engineer creates a MAR, gets its Form (the latest published MAR Form Version),
// saves an incomplete draft, and can't Send for Review until the Form is
// complete. The answers are filtered exactly like the Work Item: 404 when hidden.
import { randomUUID } from "node:crypto";
import type { FormVersion, WorkItemDetail } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company; // Contractor; its Authorized Person created the Project.
let engineer: Caller; // C1 Engineer: raises MARs.
let pm: Caller; // C1 Project Manager.
let c2Engineer: Caller; // Second Contractor.
let k1Engineer: Caller; // Consultant.
let outsider: Caller; // A C1 Member not on the Project.
let projectId = "";
let electrical = "";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const complete = { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" };

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function projectMember(company: Company, participantId: string, positions: string[]) {
  const { member, caller } = await api.member(company.caller);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(
    company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, { trade: all, location: all }),
  );
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  return caller;
}

async function otherParticipant(role: "contractor" | "consultant") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return projectMember(company, participantId, ["engineer"]);
}

const createDraft = (by: Caller, answers: Record<string, unknown>) =>
  by.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cable trays", tradeId: electrical, answers });

async function created(answers: Record<string, unknown> = {}) {
  const res = await ok(createDraft(engineer, answers), 201);
  return res.json().id as string;
}

const save = (by: Caller, id: string, answers: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers });

const sendForReview = (by: Caller, id: string) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });

async function detail(by: Caller, id: string): Promise<WorkItemDetail> {
  return (await ok(by.get(`/v1/work-items/${id}`), 200)).json();
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, own, ["engineer"]);
  pm = await projectMember(c1, own, ["project_manager"]);
  c2Engineer = await otherParticipant("contractor");
  k1Engineer = await otherParticipant("consultant");
  outsider = (await api.member(c1.caller)).caller;
});

describe("the Form for a new MAR", () => {
  it("is the latest published MAR Form Version, with its sections and fields", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    expect(form.versionNo).toBe(1);
    expect(form.schema.sections.flatMap((s) => s.fields.map((f) => [f.key, f.type, f.required]))).toEqual([
      ["manufacturer", "text", true],
      ["model", "text", false],
      ["specification_section", "text", false],
      ["description", "textarea", true],
    ]);
    expect(form.schema.sections[0]!.title).toEqual({ en: "Material details", ar: "تفاصيل المادة" });
  });

  it("is not found off the Member's Projects, or for a Type that doesn't exist", async () => {
    await expectHidden(outsider.get(`/v1/projects/${projectId}/work-item-types/MAR/form`));
    await expectHidden(engineer.get(`/v1/projects/${projectId}/work-item-types/XYZ/form`));
  });
});

describe("a new MAR", () => {
  it("is pinned to the latest Form Version, and returns that Version and its answers", async () => {
    const latest: FormVersion = (await engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`)).json();
    const id = await created({ manufacturer: "ACME Cables" });
    const d = await detail(engineer, id);
    expect(d).toMatchObject({ formVersionId: latest.id, answers: { manufacturer: "ACME Cables" } });
    const form: FormVersion = (await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json();
    expect(form).toEqual(latest);
  });

  it("is refused with a per-field list when an answer has the wrong type", async () => {
    const res = await createDraft(engineer, { manufacturer: 7, colour: "red" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "invalid_answers",
      fields: [
        { key: "manufacturer", code: "wrong_type" },
        { key: "colour", code: "unknown_field" },
      ],
    });
  });
});

describe("Save draft", () => {
  let id = "";
  beforeAll(async () => {
    id = await created();
  });

  it("is offered to the raiser's Company on its Draft only", async () => {
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(true);
    expect((await detail(pm, id)).actions.saveAnswers).toBe(true);
  });

  it("succeeds with required fields still empty", async () => {
    await ok(save(engineer, id, { model: "CT-300" }));
    expect((await detail(engineer, id)).answers).toEqual({ model: "CT-300" });
  });

  it("fails on a wrong type, and changes nothing", async () => {
    const res = await save(engineer, id, { model: ["CT-300"] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "model", code: "wrong_type" }] });
    expect((await detail(engineer, id)).answers).toEqual({ model: "CT-300" });
  });

  it("is open to the raiser's Participant only: anyone else gets 404", async () => {
    for (const who of [c2Engineer, k1Engineer, outsider]) await expectHidden(save(who, id, { model: "X" }));
  });
});

describe("Send for Review", () => {
  let id = "";
  beforeAll(async () => {
    id = await created({ model: "CT-300" });
  });

  it("is refused while the Form is incomplete, with every missing field, and changes nothing", async () => {
    const res = await sendForReview(engineer, id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "manufacturer", code: "required" },
        { key: "description", code: "required" },
      ],
    });
    expect(await detail(engineer, id)).toMatchObject({ stage: { key: "draft" }, documentNumber: null });
  });

  it("tells someone who can't take it that they can't, not what the Form lacks", async () => {
    const res = await sendForReview(pm, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_holder" });
  });

  it("succeeds once the Form is complete", async () => {
    await ok(save(engineer, id, { ...complete, model: "CT-300" }));
    await ok(sendForReview(engineer, id));
    expect(await detail(engineer, id)).toMatchObject({
      stage: { key: "internal_review" },
      answers: { ...complete, model: "CT-300" },
    });
  });

  it("leaves the answers read-only to the Draft's Save draft", async () => {
    const res = await save(engineer, id, { ...complete, model: "Later" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_editable" });
    expect((await detail(pm, id)).answers.model).toBe("CT-300");
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(false);
  });
});

describe("a hidden item's answers and Form", () => {
  let id = "";
  beforeAll(async () => {
    id = await created(complete);
  });

  it("answer 404 to every other Company and to a Member off the Project", async () => {
    for (const who of [c2Engineer, k1Engineer, outsider]) {
      await expectHidden(who.get(`/v1/work-items/${id}`));
      await expectHidden(who.get(`/v1/work-items/${id}/form`));
    }
  });

  it("answer 404 for an id that isn't a Work Item at all", async () => {
    await expectHidden(engineer.get(`/v1/work-items/${randomUUID()}/form`));
    await expectHidden(save(engineer, randomUUID(), {}));
  });
});
