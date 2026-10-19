import { describe, expect, it } from "vitest";
import { defaultTradeId, formSchema } from "./form.ts";

// The Trade field may name the code of the Trade a new item starts on (RP-627: the Site
// Observation's Form starts on "General"). It is a starting choice only: the filler can change
// it, and no check reads it.

const label = (en: string) => ({ en, ar: en });
const build = (trade: object) =>
  formSchema.parse({
    sections: [
      {
        key: "classification",
        title: label("Classification"),
        fields: [
          { key: "trade", type: "trade", label: label("Trade"), required: true, ...trade },
          { key: "location", type: "location", label: label("Location"), required: true },
        ],
      },
    ],
  });

describe("the Trade field's default code", () => {
  it("is kept when the Form names one", () => {
    expect(build({ defaultCode: "GEN" }).sections[0]!.fields[0]).toMatchObject({ type: "trade", defaultCode: "GEN" });
  });

  it("is absent when the Form names none", () => {
    expect(build({}).sections[0]!.fields[0]).not.toHaveProperty("defaultCode");
  });

  it("refuses a code that is not a Trade code", () => {
    expect(formSchema.safeParse({ sections: [{ key: "a", title: label("A"), fields: [{ key: "trade", type: "trade", label: label("T"), defaultCode: "general" }] }] }).success).toBe(false);
  });
});

describe("the Trade a new item starts on", () => {
  it("is the one whose code the Form's Trade field names, among those offered", () => {
    const offered = [
      { id: "t-el", code: "EL" },
      { id: "t-gen", code: "GEN" },
    ];
    expect(defaultTradeId(build({ defaultCode: "GEN" }), offered)).toBe("t-gen");
  });

  it("is none when the Form names none, or the Trade is not among those offered", () => {
    expect(defaultTradeId(build({}), [{ id: "t-gen", code: "GEN" }])).toBeUndefined();
    expect(defaultTradeId(build({ defaultCode: "GEN" }), [{ id: "t-el", code: "EL" }])).toBeUndefined();
  });
});
