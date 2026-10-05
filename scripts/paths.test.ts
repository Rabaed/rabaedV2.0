import { describe, expect, it } from "vitest";
import { normalPath, samePath } from "./paths.ts";

describe("samePath", () => {
  it("ignores slashes, a trailing slash and, on Windows, case", () => {
    expect(samePath("G:\\Rabaed Contech\\", "g:/rabaed contech", "win32")).toBe(true);
    expect(samePath("/srv/Rabaed/", "/srv/Rabaed", "linux")).toBe(true);
  });

  it("keeps case on other platforms, and never matches an empty path", () => {
    expect(samePath("/srv/Rabaed", "/srv/rabaed", "linux")).toBe(false);
    expect(samePath("", "", "linux")).toBe(false);
  });
});

describe("normalPath", () => {
  it("uses forward slashes and drops the trailing ones", () => {
    expect(normalPath("G:\\a\\b\\\\", "win32")).toBe("g:/a/b");
    expect(normalPath("/a/B/", "darwin")).toBe("/a/B");
  });
});
