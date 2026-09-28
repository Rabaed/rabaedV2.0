import { describe, expect, it } from "vitest";
import { dimensionValueCode, setVisibilityRequest } from "./visibility.ts";

describe("Trade and Location code", () => {
  it("is 2 to 6 letters or digits", () => {
    for (const ok of ["EL", "T1", "MEP", "ABCDEF"]) expect(dimensionValueCode.safeParse(ok).success).toBe(true);
    for (const bad of ["E", "ABCDEFG", "E-L", "E L", "كهرباء"]) expect(dimensionValueCode.safeParse(bad).success).toBe(false);
  });

  it("is stored in capitals, without surrounding spaces", () => {
    expect(dimensionValueCode.parse(" el ")).toBe("EL");
  });
});

describe("a Visibility grant", () => {
  it("is either all or a list of values", () => {
    const id = "0199a3b4-0000-7000-8000-000000000001";
    expect(setVisibilityRequest.safeParse({ isAll: true, valueIds: [] }).success).toBe(true);
    expect(setVisibilityRequest.safeParse({ isAll: false, valueIds: [id] }).success).toBe(true);
    expect(setVisibilityRequest.safeParse({ isAll: true, valueIds: [id] }).success).toBe(false);
  });
});
