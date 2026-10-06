import { describe, expect, it } from "vitest";
import { visibleProjectTabs } from "./project-tabs.tsx";

describe("visibleProjectTabs", () => {
  it("shows Dashboard, Submittals and Settings for a Project with only Submittals Types", () => {
    expect(visibleProjectTabs(["submittals"])).toEqual(["dashboard", "submittals", "settings"]);
  });

  it("always shows Dashboard, Submittals and Settings, even with no Types", () => {
    expect(visibleProjectTabs([])).toEqual(["dashboard", "submittals", "settings"]);
  });

  it("adds a Module's tab when the Project has a Type in it, in the agreed order", () => {
    expect(visibleProjectTabs(["drawings", "submittals", "snag_list"])).toEqual(["dashboard", "submittals", "snag-list", "drawings", "settings"]);
    expect(visibleProjectTabs(["submittals", "inspections", "snag_list", "site_reports", "drawings"])).toEqual([
      "dashboard",
      "submittals",
      "inspections",
      "snag-list",
      "site-reports",
      "drawings",
      "settings",
    ]);
  });
});
