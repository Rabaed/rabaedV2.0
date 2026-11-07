import { describe, expect, it } from "vitest";
import { lastForwardedEntry } from "./visitor.ts";

describe("lastForwardedEntry (RP-1230)", () => {
  it("is the last address of the list, spaces aside", () => {
    expect(lastForwardedEntry("10.9.9.9, 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("reads a header sent twice as one list", () => {
    expect(lastForwardedEntry(["10.9.9.9", "198.51.100.1, 203.0.113.7"])).toBe("203.0.113.7");
  });

  it.each([[undefined], [null], [""], [" , "], [[]]])("is undefined for %j", (header) => {
    expect(lastForwardedEntry(header)).toBeUndefined();
  });
});
