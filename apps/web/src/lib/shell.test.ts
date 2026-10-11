import { describe, expect, it } from "vitest";
import { sidebarItemOf } from "./shell.ts";

describe("sidebarItemOf", () => {
  it("marks Home on the home page", () => {
    expect(sidebarItemOf("/")).toBe("home");
  });

  it("marks Projects on the Projects page, every Project page and a Work Item", () => {
    for (const path of ["/projects", "/projects/p1", "/projects/p1/work-items", "/projects/p1/settings/numbering", "/work-items/w1"]) {
      expect(sidebarItemOf(path)).toBe("projects");
    }
  });

  it("marks My Company's pages", () => {
    expect(sidebarItemOf("/members")).toBe("members");
    expect(sidebarItemOf("/participants")).toBe("company-projects");
    expect(sidebarItemOf("/participants/p1/members/m1/visibility")).toBe("company-projects");
  });

  it("marks nothing on the Member's own pages", () => {
    expect(sidebarItemOf("/profile")).toBeUndefined();
    expect(sidebarItemOf("/notifications")).toBeUndefined();
  });
});
