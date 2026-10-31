import { describe, expect, it } from "vitest";
import { transitionGoesTo } from "./transition-goes-to.ts";

// The Work Item page's pop-up subtitle (RP-1188, gap table row 34): where the Transition takes the item.
describe("transitionGoesTo", () => {
  it("reads 'back' for a code whose outcome offers a Revision (Code C), and for a Send Back", () => {
    expect(transitionGoesTo({ kind: "close", offersRevision: true })).toBe("back");
    expect(transitionGoesTo({ kind: "send_back", offersRevision: false })).toBe("back");
  });

  it("reads 'closes' for any other close (Codes A, B and D)", () => {
    expect(transitionGoesTo({ kind: "close", offersRevision: false })).toBe("closes");
  });

  it("says nothing for a move within a Company, a Submit or a cancel", () => {
    for (const kind of ["send", "submit", "return", "cancel"] as const) expect(transitionGoesTo({ kind, offersRevision: false })).toBeNull();
  });
});
