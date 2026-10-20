import type { RegisterValues } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { confirmSuggestion, suggestedFromMapping, suggestedMapping, suggestedOnLoad } from "./register-import-suggested.ts";

type Value = RegisterValues["fields"][number]["values"][number];
const value = (key: string, how: Value["how"], match: string | null = "id"): Value => ({ key, text: key, rows: 1, match, how, score: how === "suggested" ? 90 : null });

describe("the suggestions the importer hasn't confirmed (RP-961)", () => {
  it("are the values Map values reads as suggested, field by field; an exact or chosen one never is", () => {
    const values: RegisterValues = {
      fields: [
        { field: "trade", column: 3, values: [value("elec", "suggested"), value("mechanical", "exact"), value("plumb", "manual")] },
        { field: "field:document_type", column: 8, values: [value("blueprint", "suggested"), value("nothing", null, null)] },
      ],
    };
    expect(suggestedOnLoad({ type: ["document"], trade: ["old"] }, values)).toEqual({
      type: ["document"],
      trade: ["elec"],
      "field:document_type": ["blueprint"],
    });
  });

  it("are confirmed, or changed, one value at a time: every row with it at once", () => {
    expect(confirmSuggestion({ trade: ["elec", "mech"] }, "trade", "elec")).toEqual({ trade: ["mech"] });
    expect(confirmSuggestion({ trade: ["elec"] }, "type", "elec")).toEqual({ trade: ["elec"] });
  });

  it("go in the mapping by field, only while the value is still matched", () => {
    const matches = { trade: { elec: "t1" }, "field:document_type": { blueprint: "plan" }, location: {} };
    expect(suggestedMapping({ trade: ["elec"], location: ["tower9"], "field:document_type": ["blueprint"], package: ["x"] }, matches)).toEqual({
      trade: ["elec"],
      fields: { document_type: ["blueprint"] },
    });
    expect(suggestedMapping({ trade: [] }, matches)).toBeUndefined();
  });

  it("come back with a saved mapping", () => {
    expect(suggestedFromMapping({ trade: ["elec"], fields: { document_type: ["blueprint"] } })).toEqual({
      trade: ["elec"],
      "field:document_type": ["blueprint"],
    });
    expect(suggestedFromMapping(undefined)).toEqual({});
  });
});
