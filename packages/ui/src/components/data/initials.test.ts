import { describe, expect, it } from "vitest";
import { initials } from "./initials.ts";

describe("initials", () => {
  it("takes the first letters of the first two words, upper-cased", () => {
    expect(initials("Mohamed Alhalees")).toBe("MA");
    expect(initials("hala abdullah khalid")).toBe("HA");
  });

  it("takes one letter from a one-word name", () => {
    expect(initials("Nasser")).toBe("N");
  });

  it("ignores extra spaces", () => {
    expect(initials("  Al   Waha PMC ")).toBe("AW");
  });

  // Arabic letters join, so two initials would read as a word: one letter only.
  it("takes one letter from an Arabic name", () => {
    expect(initials("محمد الحليس")).toBe("م");
  });

  it("is empty for a blank name", () => {
    expect(initials("   ")).toBe("");
  });
});
