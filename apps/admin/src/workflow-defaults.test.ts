import { describe, expect, it } from "vitest";
import { isPermutation } from "./workflow-defaults.ts";

// A reorder of a Rabaed Default set names every member exactly once (RP-528 review).
describe("isPermutation", () => {
  it("takes the same members in any order", () => {
    expect(isPermutation(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    expect(isPermutation([], [])).toBe(true);
  });

  it("refuses a repeated member standing in for a missing one", () => {
    expect(isPermutation(["x", "y"], ["x", "x"])).toBe(false);
    expect(isPermutation(["x", "x"], ["x", "y"])).toBe(false);
  });

  it("refuses one missing, one added, or one unknown", () => {
    expect(isPermutation(["a", "b"], ["a"])).toBe(false);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "z"])).toBe(false);
  });
});
