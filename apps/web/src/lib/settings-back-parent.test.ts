import { describe, expect, it } from "vitest";
import { settingsBackParent } from "./settings-back-parent.ts";

const settings = "/projects/p1/settings";

describe("settingsBackParent", () => {
  it("leads every Project settings page back to Project Settings", () => {
    for (const page of [
      "approved-suppliers",
      "checklist-templates",
      "modules",
      "numbering",
      "outcomes",
      "record",
      "required-links",
      "screens",
      "stages",
      "trades-locations",
      "visibility",
      "workflows",
    ]) {
      expect(settingsBackParent(`${settings}/${page}`)).toBe(settings);
    }
  });

  it("leads a page inside a settings page back to that page", () => {
    expect(settingsBackParent(`${settings}/checklist-templates/t1`)).toBe(`${settings}/checklist-templates`);
    expect(settingsBackParent(`${settings}/screens/s1`)).toBe(`${settings}/screens`);
    expect(settingsBackParent(`${settings}/workflows/w1/versions/3`)).toBe(`${settings}/workflows/w1`);
  });

  it("draws none on the Workflow builder, whose own bar has the way back", () => {
    expect(settingsBackParent(`${settings}/workflows/w1`)).toBeNull();
  });

  it("draws none on Project Settings itself, a top-level page", () => {
    expect(settingsBackParent(settings)).toBeNull();
    expect(settingsBackParent(`${settings}/`)).toBeNull();
  });

  it("reads the path with or without its locale, and keeps only what the path already has", () => {
    expect(settingsBackParent(`/ar${settings}/stages`)).toBe(settings);
    expect(settingsBackParent(`${settings}/stages/`)).toBe(settings);
  });

  it("draws none on a path that isn't a Project settings page", () => {
    expect(settingsBackParent("/projects/p1/work-items")).toBeNull();
    expect(settingsBackParent("/library")).toBeNull();
  });
});
