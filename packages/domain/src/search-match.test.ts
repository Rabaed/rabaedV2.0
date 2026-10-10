import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search-match.ts";

describe("matching a list's search box", () => {
  it("matches when any of the texts contains the words, whatever their case", () => {
    expect(matchesSearch("tower", ["TWR", "Riyadh Gate Tower", "برج"])).toBe(true);
    expect(matchesSearch("twr", ["TWR", "Riyadh Gate Tower"])).toBe(true);
    expect(matchesSearch("برج", ["TWR", "Riyadh Gate Tower", "برج بوابة الرياض"])).toBe(true);
    expect(matchesSearch("villa", ["TWR", "Riyadh Gate Tower"])).toBe(false);
  });

  it("matches everything when the box is empty or only spaces", () => {
    expect(matchesSearch("", ["anything"])).toBe(true);
    expect(matchesSearch("   ", [])).toBe(true);
    expect(matchesSearch(undefined, ["anything"])).toBe(true);
  });

  it("ignores the spaces around the words, not between them", () => {
    expect(matchesSearch("  gate tower ", ["Riyadh Gate Tower"])).toBe(true);
    expect(matchesSearch("gate  tower", ["Riyadh Gate Tower"])).toBe(false);
  });
});
