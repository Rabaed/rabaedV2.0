// Seam 1 for the Form engine's tracer (RP-262, spec RP-261): a Contractor
// Engineer creates a MAR, gets its Form (the latest published MAR Form Version),
// saves an incomplete draft, and can't Send for Review until the Form is
// complete. The answers are filtered exactly like the Work Item: 404 when hidden.
import { randomUUID } from "node:crypto";
import { formSchemaProblems, isAnswerField, type FormVersion } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { detail, projectMember } from "./support/tower.ts";

const api = await createTestApi({ files: true });
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
let buildingA = "";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const complete = { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" };

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function otherParticipant(role: "contractor" | "consultant") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return projectMember(api, company, participantId, ["engineer"]);
}

const createDraft = (by: Caller, answers: Record<string, unknown>) =>
  by.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cable trays", answers: { trade: electrical, ...answers } });

async function created(answers: Record<string, unknown> = {}) {
  const res = await ok(createDraft(engineer, answers), 201);
  return res.json().id as string;
}

/** Save draft: the whole set of answers, so the Trade (required even in a Draft) is always among them. */
const save = (by: Caller, id: string, answers: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { trade: electrical, ...answers } });

const sendForReview = (by: Caller, id: string) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", confirmed: true, idempotencyKey: randomUUID() });

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
  pm = await projectMember(api, c1, own, ["project_manager"]);
  c2Engineer = await otherParticipant("contractor");
  k1Engineer = await otherParticipant("consultant");
  outsider = (await api.member(c1.caller)).caller;
});

describe("the Form for a new MAR", () => {
  it("is the latest published MAR Form Version, with its sections and fields", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    // The MAR Form Version 4 (RP-306); mar-form-v2.test.ts to mar-form-v4.test.ts follow it further.
    expect(form.versionNo).toBe(4);
    expect(form.schema.sections.flatMap((s) => s.fields.filter(isAnswerField).map((f) => [f.key, f.type, f.required]))).toEqual([
      ["manufacturer", "text", true],
      ["model", "text", false],
      ["specification_section", "text", false],
      ["description", "textarea", true],
      ["items", "table", false],
      ["datasheet", "attachments", true],
      ["test_certificate", "attachments", false],
      ["sample_photo", "photos", false],
      ["related_submittals", "work_item_ref", false],
      ["sample_checked", "yes_no", true],
      ["matches_specification", "yes_no", true],
      ["verification_note", "textarea", { field: "matches_specification", op: "=", value: false }],
      // The Built-in Fields, placed in the Form (RP-270).
      ["trade", "trade", true],
      ["location", "location", true],
      ["scopes", "scopes", false],
    ]);
    expect(form.schema.sections[0]!.title).toEqual({ en: "Material details", ar: "تفاصيل المادة" });
    // A Form that could be published: every Built-in Field once, Trade and Location required.
    expect(formSchemaProblems(form.schema)).toEqual([]);
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

  it("is offered to the raiser's Company on its Draft", async () => {
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(true);
    expect((await detail(pm, id)).actions.saveAnswers).toBe(true);
  });

  it("succeeds with required fields still empty", async () => {
    await ok(save(engineer, id, { model: "CT-300" }));
    expect((await detail(engineer, id)).answers).toEqual({ model: "CT-300", trade: electrical });
  });

  it("fails on a wrong type, and changes nothing", async () => {
    const res = await save(engineer, id, { model: ["CT-300"] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "model", code: "wrong_type" }] });
    expect((await detail(engineer, id)).answers).toEqual({ model: "CT-300", trade: electrical });
  });

  it("takes each Item's quantity as a number, and refuses text, a negative or too many decimals, naming the cell", async () => {
    const row = (quantity: unknown) => ({ fixture_type: "Cable tray", quantity, unit: "m" });
    for (const [value, code] of [["12", "wrong_type"], [-1, "below_min"], [1.234, "too_many_decimals"]] as const) {
      const res = await save(engineer, id, { items: [row(value)] });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "items", code, row: 0, column: "quantity" }] });
    }
    await ok(save(engineer, id, { model: "CT-300", items: [row(120.5)] }));
    expect((await detail(engineer, id)).answers).toMatchObject({ items: [row(120.5)] });
    await ok(save(engineer, id, { model: "CT-300" }));
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
        { key: "datasheet", code: "required" },
        { key: "location", code: "required" },
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
    await ok(save(engineer, id, { ...complete, location: buildingA, model: "CT-300" }));
    await attachDatasheet(engineer, id);
    await ok(sendForReview(engineer, id));
    expect(await detail(engineer, id)).toMatchObject({
      stage: { key: "internal_review" },
      answers: { ...complete, model: "CT-300", trade: electrical, location: buildingA },
    });
  });

  it("keeps the answers open to the raiser's Company at Internal Review (RP-268)", async () => {
    await ok(save(engineer, id, { ...complete, location: buildingA, model: "Later" }));
    expect((await detail(pm, id)).answers.model).toBe("Later");
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(true);
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
