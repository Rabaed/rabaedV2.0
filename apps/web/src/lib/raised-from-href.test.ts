import { workItemQueryFromSearchParams } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { raisedFromHref } from "./raised-from-href.ts";

/** The query the Snag List reads back from `href`, as its page does. */
const readBack = (href: string) => workItemQueryFromSearchParams(new URLSearchParams(href.split("?")[1]));

describe("raisedFromHref: \"Open in Snag List\" (RP-1119)", () => {
  it("opens the Snag List filtered to the Type raised from the item's number", () => {
    const href = raisedFromHref("p1", "SNG", "TWR-C1-EL-WIR-0007")!;
    expect(href.split("?")[0]).toBe("/projects/p1/snag-list");
    expect(readBack(href)).toMatchObject({ type: ["SNG"], raisedFrom: ["TWR-C1-EL-WIR-0007"] });
  });

  it("keeps the filter at every Revision: the Snag List reads a Revision's number back", () => {
    for (const number of ["TWR-C1-EL-WIR-0007 Rev 1", "TWR-C1-EL-WIR-0007 Rev 2", "TWR-C1-EL-WIR-0007 Rev 14"])
      expect(readBack(raisedFromHref("p1", "CMT", number)!), number).toMatchObject({ type: ["CMT"], raisedFrom: [number] });
  });

  it("gives no link for an item with no number yet, nor for a number the filter can't express, rather than one that opens unfiltered", () => {
    expect(raisedFromHref("p1", "SNG", null)).toBeNull();
    expect(raisedFromHref("p1", "SNG", "Not a number")).toBeNull();
  });
});
