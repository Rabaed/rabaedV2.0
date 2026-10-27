import { describe, expect, it } from "vitest";
import { hasOwnFrame } from "./signed-out-frame.ts";

describe("signed-out pages with a frame of their own (RP-1057)", () => {
  it("is the sign-in page only", () => {
    expect(hasOwnFrame("/sign-in")).toBe(true);
    expect(hasOwnFrame("/sign-in/")).toBe(true);
    expect(hasOwnFrame("/accept-invitation")).toBe(false);
    expect(hasOwnFrame("/")).toBe(false);
    expect(hasOwnFrame("/sign-in-help")).toBe(false);
  });
});
