import { describe, expect, it } from "vitest";
import { projectCode } from "./project.ts";

describe("Project code", () => {
  it("is 2 to 10 letters or digits", () => {
    for (const ok of ["TW", "TWR", "TWR2", "ABCDEFGHIJ"]) expect(projectCode.safeParse(ok).success).toBe(true);
    for (const bad of ["T", "ABCDEFGHIJK", "TW-R", "TW R", "برج"]) expect(projectCode.safeParse(bad).success).toBe(false);
  });

  it("is stored in capitals, without surrounding spaces", () => {
    expect(projectCode.parse(" twr ")).toBe("TWR");
  });
});
