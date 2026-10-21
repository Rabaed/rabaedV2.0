import type { DimensionValues } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { isLastLevel, locationChoices, locationPath, parsePhoneStep, phoneFlowStep, phoneSteps, withLocation } from "./snag-phone-flow.ts";

// Story data only.
const b = (en: string) => Object.fromEntries([
  ["en", en],
  ["ar", en],
]) as { en: string; ar: string };
const place = (id: string, parentId: string | null, depth: number) => ({ id, parentId, depth, levelName: null, code: id.toUpperCase(), name: b(id) });
const locations: DimensionValues["location"] = [place("zone", null, 1), place("t1", "zone", 2), place("t1f1", "t1", 3), place("t1f2", "t1", 3), place("t2", "zone", 2)];
const draft = (answers: Record<string, unknown>, category: "draft" | "in_progress" = "draft") => ({ answers, stage: { category } });

describe("phoneSteps", () => {
  it("is the camera, then the Subject, the Location and the Raise: no Pin until Pins exist, and the Contractor picked in the Raise pop-up (RP-658)", () => {
    expect(phoneSteps).toEqual(["photo", "subject", "location", "raise"]);
  });
});

describe("parsePhoneStep", () => {
  it("reads a step from the URL, and nothing else", () => {
    expect(parsePhoneStep("location")).toBe("location");
    expect(parsePhoneStep("raise")).toBe("raise");
    expect(parsePhoneStep("contractor")).toBeUndefined();
    expect(parsePhoneStep(undefined)).toBeUndefined();
  });
});

describe("isLastLevel", () => {
  it("is a place with nothing inside it (a Floor): the Location step's Next waits for one", () => {
    expect(isLastLevel(locations, "t1f1")).toBe(true);
    expect(isLastLevel(locations, "t1")).toBe(false);
    expect(isLastLevel(locations, "zone")).toBe(false);
    expect(isLastLevel(locations, undefined)).toBe(false);
  });
});

describe("phoneFlowStep", () => {
  it("opens at the camera without a Draft: the photos taken before it are not kept", () => {
    expect(phoneFlowStep({ draft: null })).toBe("photo");
    expect(phoneFlowStep({ draft: null, step: "subject" })).toBe("photo");
    expect(phoneFlowStep({ draft: null, step: "location" })).toBe("photo");
  });

  it("reopens a Draft at the step the page was at, after the Subject", () => {
    expect(phoneFlowStep({ draft: draft({ trade: "el" }), step: "location" })).toBe("location");
    expect(phoneFlowStep({ draft: draft({ trade: "el", location: "t1f1" }), step: "location" })).toBe("location");
    expect(phoneFlowStep({ draft: draft({ trade: "el", location: "t1f1" }), step: "raise" })).toBe("raise");
    // The Subject is fixed once the Draft exists: it is never reopened.
    expect(phoneFlowStep({ draft: draft({ trade: "el" }), step: "subject" })).toBe("location");
  });

  it("without a step, or at Raise with no Location yet, opens at the first step not done", () => {
    expect(phoneFlowStep({ draft: draft({ trade: "el" }) })).toBe("location");
    expect(phoneFlowStep({ draft: draft({ trade: "el" }), step: "raise" })).toBe("location");
    expect(phoneFlowStep({ draft: draft({ trade: "el", location: "t1f2" }) })).toBe("raise");
  });

  it("is done once the item has left Draft: its page takes over", () => {
    expect(phoneFlowStep({ draft: draft({ location: "t1f1" }, "in_progress"), step: "location" })).toBe("done");
  });
});

describe("the Location step", () => {
  it("offers the Zones, then what is inside the place picked: Zone → Building → Floor", () => {
    expect(locationChoices(locations, null).map((l) => l.id)).toEqual(["zone"]);
    expect(locationChoices(locations, "zone").map((l) => l.id)).toEqual(["t1", "t2"]);
    expect(locationChoices(locations, "t1").map((l) => l.id)).toEqual(["t1f1", "t1f2"]);
    expect(locationChoices(locations, "t1f1")).toEqual([]);
  });

  it("reads the path down to the place picked, outermost first", () => {
    expect(locationPath(locations, "t1f2").map((l) => l.id)).toEqual(["zone", "t1", "t1f2"]);
    expect(locationPath(locations, undefined)).toEqual([]);
    // A place the viewer no longer covers: nothing to show.
    expect(locationPath(locations, "gone")).toEqual([]);
  });

  it("saves the Draft's answers as read with the Location picked, and nothing else changed", () => {
    expect(withLocation({ description: "Loose", trade: "el", location: "t1" }, "t1f1")).toEqual({ description: "Loose", trade: "el", location: "t1f1" });
  });
});
