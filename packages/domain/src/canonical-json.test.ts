import { describe, expect, it } from "vitest";
import { canonicalJson, compareStrings, sameJson } from "./canonical-json.ts";

describe("canonical JSON", () => {
  it("sorts strings by code unit, never by locale", () => {
    expect(["b", "B", "a", "_"].sort(compareStrings)).toEqual(["B", "_", "a", "b"]);
  });

  it("compares documents by content, whatever the order of their keys, keeping array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(sameJson({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
