import { describe, expect, it } from "vitest";
import { visibleProjectTabs } from "./project-tabs.tsx";

describe("visibleProjectTabs", () => {
  it("shows Dashboard, Submittals and Settings for a Project with only Submittals Types", () => {
    expect(visibleProjectTabs(["submittals"])).toEqual(["dashboard", "submittals", "settings"]);
  });

  it("always shows Dashboard, Submittals and Settings, even with no Types; the Activity Feed is in the Dashboard (RP-1142)", () => {
    expect(visibleProjectTabs([])).toEqual(["dashboard", "submittals", "settings"]);
  });

  it("adds a Module's tab when the Project has a Type in it, in the kit's order: Site Reports before Snag List, Drawings after them (RP-1142)", () => {
    expect(visibleProjectTabs(["drawings", "submittals", "snag_list"])).toEqual(["dashboard", "submittals", "snag_list", "drawings", "settings"]);
    expect(visibleProjectTabs(["submittals", "inspections", "snag_list", "site_reports", "drawings"])).toEqual([
      "dashboard",
      "submittals",
      "inspections",
      "site_reports",
      "snag_list",
      "drawings",
      "settings",
    ]);
  });
});
