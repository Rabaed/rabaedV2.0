// Seam 1 for the MAR Form Version 7 (RP-1152, gap rows 24, 25, 28, 30, 31 and 32; decision 5):
// the New item's order. Classification comes first, with the Trade, the Approved supplier
// (moved from Material details), the Location and the Scopes; then Material details, Items,
// Documents, and the References section retitled Links. Every field keeps its key and its
// required flag, so answers and Documental Records carry over. MARs on Version 6 keep theirs.
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

const marForm = async (): Promise<FormVersion> => (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();

describe("the MAR Form Version 7", () => {
  it("puts Classification first, then Material details, Items, Documents and Links", async () => {
    const { schema } = await marForm();
    expect(schema.sections.map((s) => [s.key, s.title])).toEqual([
      ["classification", { en: "Classification", ar: "التصنيف" }],
      ["material", { en: "Material details", ar: "تفاصيل المادة" }],
      ["quantities", { en: "Items", ar: "البنود" }],
      ["documents", { en: "Documents", ar: "المستندات" }],
      ["references", { en: "Links", ar: "الروابط" }],
    ]);
  });

  it("orders the fields Trade, Approved supplier, Location, Scopes, then the Material details, keeping Version 6's keys and required flags", async () => {
    const { schema } = await marForm();
    expect(schema.sections.map((s) => s.fields.map((f) => [f.key, f.type, "required" in f ? f.required : false]))).toEqual([
      [
        ["trade", "trade", true],
        ["supplier", "approved_supplier", true],
        ["location", "location", true],
        ["scopes", "scopes", false],
      ],
      [
        ["manufacturer", "text", true],
        ["model", "text", false],
        ["specification_section", "text", false],
        ["description", "textarea", true],
      ],
      [["items", "table", false]],
      [
        ["datasheet", "attachments", true],
        ["test_certificate", "attachments", false],
        ["sample_photo", "photos", false],
      ],
      [["related_submittals", "work_item_ref", false]],
    ]);
  });

  it("totals the Items' Quantity", async () => {
    const items = (await marForm()).schema.sections.flatMap((s) => s.fields).find((f) => f.key === "items");
    expect(items?.type === "table" && items.columns.find((c) => c.key === "quantity")).toMatchObject({ type: "number", total: true });
  });
});
