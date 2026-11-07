import { describe, expect, it } from "vitest";
import { transitionCodes } from "./page-model.ts";

describe("the code on a Transition's button (RP-1151, gap table row 27)", () => {
  const definition = {
    transitions: [
      { key: "approve_a", kind: "close", outcome: "A" },
      { key: "revise_c", kind: "close", outcome: "C" },
      { key: "return", kind: "return", outcome: null },
    ],
  };

  it("is the outcome its Workflow's close Transition sets, by the offered Transition's key", () => {
    const codes = transitionCodes([{ key: "approve_a" }, { key: "revise_c" }, { key: "return" }], definition);
    expect(codes).toEqual({ approve_a: "A", revise_c: "C" });
  });

  it("is none for a Transition the definition doesn't know, or with no definition read", () => {
    expect(transitionCodes([{ key: "submit" }], definition)).toEqual({});
    expect(transitionCodes([{ key: "approve_a" }], null)).toEqual({});
  });
});
