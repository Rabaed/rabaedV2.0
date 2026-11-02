// Seam 1 for the WIR Form Version 4 (RP-1221, gap rows 18 and 19, approved 2026-11-02): the New
// item's order. Classification comes first, with the Trade, the Location and the Scopes; the rest
// keep their order (Work to inspect, Documents, References, Checklist). Requested for's help says
// "inspection", not "visit" (GLOSSARY.md Inspection). Every field keeps its key, type and required
// flag, so answers, Checklists and Documental Records carry over. WIRs on Versions 1 to 3 keep theirs.
import type { FormVersion } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, ok, projectMember } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let engineer: Caller;
let projectId = "";

beforeAll(async () => {
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
});

const wirForm = async (): Promise<FormVersion> => (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/WIR/form`), 200)).json();

describe("the WIR Form Version 4", () => {
  it("puts Classification first, then Work to inspect, Documents, References and Checklist", async () => {
    const { schema } = await wirForm();
    expect(schema.sections.map((s) => [s.key, s.title])).toEqual([
      ["classification", { en: "Classification", ar: "التصنيف" }],
      ["inspection", { en: "Work to inspect", ar: "الأعمال المطلوب معاينتها" }],
      ["documents", { en: "Documents", ar: "المستندات" }],
      ["references", { en: "References", ar: "المراجع" }],
      ["checklist", { en: "Checklist", ar: "قائمة التحقق" }],
    ]);
  });

  it("keeps Version 3's fields, keys and required flags, in their order inside each section", async () => {
    const { schema } = await wirForm();
    expect(schema.sections.map((s) => s.fields.map((f) => [f.key, f.type, "required" in f ? f.required : false]))).toEqual([
      [
        ["trade", "trade", true],
        ["location", "location", true],
        ["scopes", "scopes", false],
      ],
      [
        ["description", "textarea", true],
        ["specification_section", "text", false],
        ["requested_for", "datetime", true],
      ],
      [
        ["attachments", "attachments", false],
        ["photos", "photos", false],
      ],
      [["approved_submittals", "work_item_ref", false]],
      [["checklist_template", "checklist_template", true]],
    ]);
  });

  it("asks for Requested for as the inspection's proposed time, never a visit", async () => {
    const requestedFor = (await wirForm()).schema.sections.flatMap((s) => s.fields).find((f) => f.key === "requested_for");
    expect(requestedFor && "help" in requestedFor && requestedFor.help).toEqual({
      en: "When the work will be ready: a proposed time for the inspection.",
      ar: "متى تكون الأعمال جاهزة: موعد مقترح للمعاينة.",
    });
  });
});
