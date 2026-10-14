// The Rabaed Default Forms of the Supplier Approval Request (SAR) and the Document
// Approval Request (DAR) (RP-591, spec RP-598; form-engine.md §2.11). The seam suites'
// global setup runs the demo seed, which publishes the Rabaed Defaults, so each Type has
// a Form of its own and a new item of it is pinned to that Form's Version.
import { rabaedDefaultTypes, rabaedFormFile } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, publishProblems, type FormVersion } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let projectId = "";
let electrical = "";
let buildingA = "";
let hafiz: Caller; // A Contractor Engineer: raises the items.

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  projectId = (await api.createProject(c1.caller, { code: "SDF" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const participantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  hafiz = await projectMember(api, c1, participantId, ["engineer"], { name: "Hafiz Hamdan" });
});

const sarAnswers = () => ({
  supplier_name_en: "Al-Rimal Building Materials",
  supplier_name_ar: "الرمال لمواد البناء",
  commercial_registration_number: "1010123456",
  proposed_supply: "Cement and concrete blocks",
  past_projects: [{ project_name: "Riyadh Metro Station 4", year: 2022 }],
  trade: electrical,
  location: buildingA,
});
const darAnswers = () => ({ document_type: "calculation", document_title: "Cable sizing calculation", trade: electrical, location: buildingA });

describe("the SAR and DAR Forms as published documents", () => {
  it.each(["SAR", "DAR"])("%s passes every publish check, with the Built-in Fields and unique keys", (type) => {
    const file = rabaedDefaultTypes.find((t) => t.type === type)!.form!;
    const schema = formSchema.parse(rabaedFormFile(file));
    expect(publishProblems(schema, [])).toEqual([]);
    const keys = schema.sections.flatMap((s) => [s.key, ...s.fields.map((f) => f.key)]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(schema.sections.flatMap((s) => s.fields.map((f) => f.type))).toEqual(expect.arrayContaining(["trade", "location", "scopes"]));
  });

  it("the SAR's supplier name keys (read by 'a SAR adds its supplier') are required text, English and Arabic", () => {
    const schema = formSchema.parse(rabaedFormFile("SAR.json"));
    const fields = schema.sections.flatMap((s) => s.fields);
    for (const key of ["supplier_name_en", "supplier_name_ar"]) {
      expect(fields.find((f) => f.key === key), key).toMatchObject({ type: "text", required: true });
    }
  });

  it("every label is in English and Arabic (formSchema requires both)", () => {
    for (const file of ["SAR.json", "DAR.json"]) expect(formSchema.safeParse(rabaedFormFile(file)).success, file).toBe(true);
  });
});

describe("a SAR and a DAR raised on a Project use their own Form Version (seam 1)", () => {
  it("each Type has a Form definition of its own, not the MAR's", async () => {
    const types = await migrator
      .selectFrom("work_item_type")
      .select(["code", "form_definition_id"])
      .where("owner_kind", "=", "rabaed")
      .where("code", "in", ["MAR", "SAR", "DAR"])
      .execute();
    const forms = types.map((t) => t.form_definition_id);
    expect(forms.every(Boolean)).toBe(true);
    expect(new Set(forms).size).toBe(3);
  });

  it("the new-item Form of SAR and DAR is theirs", async () => {
    const sar: FormVersion = (await ok(hafiz.get(`/v1/projects/${projectId}/work-item-types/SAR/form`), 200)).json();
    const dar: FormVersion = (await ok(hafiz.get(`/v1/projects/${projectId}/work-item-types/DAR/form`), 200)).json();
    expect(sar.schema.sections.map((s) => s.key)).toEqual(["supplier", "proposal", "experience", "documents", "classification"]);
    expect(dar.schema.sections.map((s) => s.key)).toEqual(["document_details", "documents", "classification"]);
    expect(sar.id).not.toBe(dar.id);
  });

  it("a SAR takes the SAR's answers and a DAR the DAR's, and neither takes the MAR's", async () => {
    await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "SAR", title: "Al-Rimal", answers: sarAnswers() }), 201);
    await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "DAR", title: "Cable sizing", answers: darAnswers() }), 201);
    const marOnly = { manufacturer: "Philips", description: "LED", trade: electrical, location: buildingA };
    expect((await hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "SAR", title: "Wrong", answers: marOnly })).statusCode).toBe(422);
    expect((await hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "DAR", title: "Wrong", answers: marOnly })).statusCode).toBe(422);
  });
});
