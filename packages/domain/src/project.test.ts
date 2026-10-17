import { describe, expect, it } from "vitest";
import { moduleKeys, type ModuleKey } from "./module.ts";
import { moduleOfTabPath, moduleTabOrder, moduleTabPaths, projectCode, projectTabModules } from "./project.ts";

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
    expect(moduleTabOrder.map((m) => moduleTabPaths[m])).toEqual(["work-items", "inspections", "snag-list", "site-reports", "drawings"]);
  });

  it("cover every Module once", () => {
    expect([...moduleTabOrder].sort()).toEqual([...moduleKeys].sort());
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

describe("Module tabs", () => {
  it("keep Inspections' tab when the Project has no Submittals tab to show them in (RP-652)", () => {
    expect(projectTabModules({ modules: ["inspections", "snag_list"], showInspectionsInSubmittals: true })).toEqual(["inspections", "snag_list"]);
  });

  const project = { modules: ["submittals", "inspections", "snag_list"] as ModuleKey[] };

  it("are the Project's Modules while Inspections have their own tab", () => {
    expect(projectTabModules({ ...project, showInspectionsInSubmittals: false })).toEqual(["submittals", "inspections", "snag_list"]);
  });

  it("leave out Inspections while the Project shows it in the Submittals tab (RP-652), and nothing else", () => {
    expect(projectTabModules({ ...project, showInspectionsInSubmittals: true })).toEqual(["submittals", "snag_list"]);
  });
});
