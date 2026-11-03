// Seam 1 for the SNG Form's new Version (RP-1222 gap row 17): the New Snag's short form asks
// the Trade and the Location first, so they stay for the next Snag. Classification comes first,
// with the Trade, the Location and the Scopes; then the Snag, with its Description and Photos.
// Every field keeps its key, type and required flag, so answers and Documental Records carry over.
import type { FormVersion } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { buildTower, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let at: Tower;
let consultant: Caller;

beforeAll(async () => {
  at = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "SFV");
  consultant = at.k1Manager;
});

const sngForm = async (): Promise<FormVersion> => {
  const res = await consultant.get(`/v1/projects/${at.projectId}/work-item-types/SNG/form`);
  expect(res.statusCode).toBe(200);
  return res.json();
};

describe("the SNG Form, Classification first", () => {
  it("puts Classification first, then the Snag", async () => {
    const { schema } = await sngForm();
    expect(schema.sections.map((s) => [s.key, s.title])).toEqual([
      ["classification", { en: "Classification", ar: "التصنيف" }],
      ["details", { en: "Snag", ar: "العيب" }],
    ]);
  });

  it("orders the fields Trade, Location, Scopes, then Description and Photos, keeping their keys and required flags", async () => {
    const { schema } = await sngForm();
    expect(schema.sections.map((s) => s.fields.map((f) => [f.key, f.type, "required" in f ? f.required : false]))).toEqual([
      [
        ["trade", "trade", true],
        ["location", "location", true],
        ["scopes", "scopes", false],
      ],
      [
        ["description", "textarea", true],
        ["photos", "photos", false],
      ],
    ]);
  });
});
