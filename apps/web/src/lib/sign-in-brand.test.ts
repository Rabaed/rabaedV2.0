import { describe, expect, it } from "vitest";
import { brandStep } from "./sign-in-brand.ts";

describe("the sign-in brand panel's cycle (RP-1057, the owner's design)", () => {
  it("passes the document from Contractor to Consultant to Owner, with the design's times", () => {
    expect([0, 1, 2].map(brandStep)).toEqual([
      { role: "contractor", status: "sent", time: "07:12" },
      { role: "consultant", status: "reviewed", time: "09:40" },
      { role: "owner", status: "approved", time: "12:05" },
    ]);
  });

  it("starts again with the Contractor after the Owner", () => {
    expect(brandStep(3)).toEqual(brandStep(0));
    expect(brandStep(7).role).toBe("consultant");
  });
});
