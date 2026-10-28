import { describe, expect, it } from "vitest";
import { tokenFromHash } from "./link-token.ts";

describe("an emailed link's token", () => {
  it("is read from the URL fragment", () => {
    expect(tokenFromHash("#token=abc_-123")).toBe("abc_-123");
  });

  it("is null when the fragment has none", () => {
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#other=1")).toBeNull();
  });
});
