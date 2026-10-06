import { describe, expect, it } from "vitest";
import { moduleKeys, moduleOfTabPath, moduleTabPaths, projectCode } from "./project.ts";

describe("Project code", () => {
  it("is 2 to 10 letters or digits", () => {
    for (const ok of ["TW", "TWR", "TWR2", "ABCDEFGHIJ"]) expect(projectCode.safeParse(ok).success).toBe(true);
    for (const bad of ["T", "ABCDEFGHIJK", "TW-R", "TW R", "برج"]) expect(projectCode.safeParse(bad).success).toBe(false);
  });

  it("is stored in capitals, without surrounding spaces", () => {
    expect(projectCode.parse(" twr ")).toBe("TWR");
  });
});

describe("Module tab paths", () => {
  it("keep the URLs as they are: Submittals at work-items, the others by their name", () => {
    expect(moduleKeys.map((m) => moduleTabPaths[m])).toEqual(["work-items", "inspections", "snag-list", "site-reports", "drawings"]);
  });

  it("read back to their Module, and nothing else does", () => {
    expect(moduleOfTabPath("work-items")).toBe("submittals");
    expect(moduleOfTabPath("snag-list")).toBe("snag_list");
    expect(moduleOfTabPath("site-reports")).toBe("site_reports");
    expect(moduleOfTabPath("submittals")).toBeNull();
    expect(moduleOfTabPath("settings")).toBeNull();
    expect(moduleOfTabPath("snag_list")).toBeNull();
  });
});
