import { describe, expect, it } from "vitest";
import { isYes } from "./confirm.ts";

describe("isYes", () => {
  it("accepts y and yes in any case, with spaces around", () => {
    for (const answer of ["y", "Y", "yes", "YES", " yes \n"]) expect(isYes(answer), answer).toBe(true);
  });

  it("treats anything else, including an empty answer, as no", () => {
    for (const answer of ["", "n", "no", "yess", "ye", "y es", "sure"]) expect(isYes(answer), answer).toBe(false);
  });
});
