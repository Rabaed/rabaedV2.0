import { describe, expect, it } from "vitest";
import { newItemHref, newPageWords, projectTabOf } from "./new-item-route.ts";

describe("newPageWords", () => {
  it("heads the Inspections' New page with New Inspection, never New Submittal, even for one who can't raise one (RP-1179)", () => {
    expect(newPageWords("inspections")).toEqual({ heading: "newInspection", noType: "noRaisableInspection" });
  });

  it("keeps the Submittals' words for the Submittals and the Modules that have none of their own yet", () => {
    expect(newPageWords("submittals")).toEqual({ heading: "newItem", noType: "noRaisableType" });
    expect(newPageWords("snag_list")).toEqual({ heading: "newItem", noType: "noRaisableType" });
  });
});

describe("projectTabOf", () => {
  // The Project's Modules with a tab of their own.
  const tabs = ["submittals", "inspections", "snag_list"] as const;

  it("is the tab whose page is open", () => {
    expect(projectTabOf("p1", "/projects/p1", null, tabs)).toBe("dashboard");
    expect(projectTabOf("p1", "/projects/p1/work-items", null, tabs)).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/inspections", null, tabs)).toBe("inspections");
    expect(projectTabOf("p1", "/projects/p1/snag-list/new", null, tabs)).toBe("snag_list");
    expect(projectTabOf("p1", "/projects/p1/settings/modules", null, tabs)).toBe("settings");
    expect(projectTabOf("p1", "/projects", null, tabs)).toBeUndefined();
  });

  it("is the Module the New page raises in: Inspections on New WIR, not Submittals (RP-1179)", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections", tabs)).toBe("inspections");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "snag_list", tabs)).toBe("snag_list");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", null, tabs)).toBe("submittals");
  });

  it("is Submittals on New WIR when the Project shows Inspections in the Submittals tab (RP-652)", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections", ["snag_list"])).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections", ["inspections", "snag_list"])).toBe("inspections");
  });

  it("keeps Submittals for a Module the URL names wrongly, or on a page other than New", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "nonsense", tabs)).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/work-items/import", "inspections", tabs)).toBe("submittals");
  });
});

describe("newItemHref", () => {
  it("opens the Submittals' New page with no Module named", () => {
    expect(newItemHref("p1", "submittals")).toBe("/projects/p1/work-items/new");
    expect(newItemHref("p1", "submittals", "MAR")).toBe("/projects/p1/work-items/new?type=MAR");
  });

  it("names another Module, so a WIR opens as New WIR under Inspections, not New Submittal (RP-1179)", () => {
    expect(newItemHref("p1", "inspections")).toBe("/projects/p1/work-items/new?module=inspections");
    expect(newItemHref("p1", "inspections", "WIR")).toBe("/projects/p1/work-items/new?module=inspections&type=WIR");
  });

  it("keeps a Type code with odd characters in one query value", () => {
    expect(newItemHref("p1", "snag_list", "A&B")).toBe("/projects/p1/work-items/new?module=snag_list&type=A%26B");
  });
});
