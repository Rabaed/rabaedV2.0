import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PHONE, TABLET } from "./widths.ts";

// The owner's tiers (RP-1158, Rabaed Responsive Anatomy, RP-1271): a phone is below 768, a tablet up to and including 1024.
describe("the phone and tablet widths", () => {
  it("is a phone below 768 wide", () => {
    expect(PHONE).toBe("(max-width: 767.98px)");
  });

  it("is a tablet (or narrower) up to and including 1024 wide", () => {
    expect(TABLET).toBe("(max-width: 1024px)");
  });

  it("has CSS variants at the same widths, so a class and a hook switch together", () => {
    const css = readFileSync(new URL("../styles/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/@custom-variant phone \(@media \(max-width: 767\.98px\)\);/);
    expect(css).toMatch(/@custom-variant tablet \(@media \(max-width: 1024px\)\);/);
  });
});
