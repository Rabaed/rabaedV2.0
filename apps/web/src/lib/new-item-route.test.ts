import { describe, expect, it } from "vitest";
import { newItemHref, projectTabOf } from "./new-item-route.ts";

describe("projectTabOf", () => {
  it("is the tab whose page is open", () => {
    expect(projectTabOf("p1", "/projects/p1", null)).toBe("dashboard");
    expect(projectTabOf("p1", "/projects/p1/work-items", null)).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/inspections", null)).toBe("inspections");
    expect(projectTabOf("p1", "/projects/p1/snag-list/new", null)).toBe("snag_list");
    expect(projectTabOf("p1", "/projects/p1/settings/modules", null)).toBe("settings");
    expect(projectTabOf("p1", "/projects", null)).toBeUndefined();
  });

  it("is the Module the New page raises in: Inspections on New WIR, not Submittals (RP-1179)", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections")).toBe("inspections");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "snag_list")).toBe("snag_list");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", null)).toBe("submittals");
  });

  it("is Submittals on New WIR when the Project shows Inspections in the Submittals tab (RP-652)", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections", ["snag_list"])).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "inspections", ["inspections", "snag_list"])).toBe("inspections");
  });

  it("keeps Submittals for a Module the URL names wrongly, or on a page other than New", () => {
    expect(projectTabOf("p1", "/projects/p1/work-items/new", "nonsense")).toBe("submittals");
    expect(projectTabOf("p1", "/projects/p1/work-items/import", "inspections")).toBe("submittals");
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
