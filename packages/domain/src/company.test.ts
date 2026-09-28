import { describe, expect, it } from "vitest";
import { crNumber, vatNumber } from "./company.ts";

describe("CR number", () => {
  it("is ten digits", () => {
    expect(crNumber.safeParse("1010123456").success).toBe(true);
    expect(crNumber.safeParse("101012345").success).toBe(false);
    expect(crNumber.safeParse("10101234567").success).toBe(false);
    expect(crNumber.safeParse("10101234a6").success).toBe(false);
  });

  it("ignores surrounding spaces", () => {
    expect(crNumber.parse(" 1010123456 ")).toBe("1010123456");
  });
});

describe("VAT number", () => {
  it("is fifteen digits starting and ending with 3", () => {
    expect(vatNumber.safeParse("300000000000003").success).toBe(true);
    expect(vatNumber.safeParse("310123456700003").success).toBe(true);
    expect(vatNumber.safeParse("200000000000003").success).toBe(false);
    expect(vatNumber.safeParse("300000000000002").success).toBe(false);
    expect(vatNumber.safeParse("30000000000003").success).toBe(false);
  });
});
