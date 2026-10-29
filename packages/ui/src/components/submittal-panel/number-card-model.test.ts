import { describe, expect, it } from "vitest";
import { submittalNumberCard, submittalNumberPlace } from "./number-card-model.ts";

// Story data only: the item read decides the segments (RP-1065); the card draws what it is given.
const segments = {
  separator: "-" as const,
  segments: [
    { kind: "project" as const, value: "TWR" },
    { kind: "participant" as const, value: "TMC" },
    { kind: "trade" as const, value: "EL" },
    { kind: "type" as const, value: "MAR" },
    { kind: "sequence" as const, value: "042" },
  ],
};

describe("the Submittal Panel's number card (RP-1065, README §4.3)", () => {
  it("is shown only for a number with segments", () => {
    expect(submittalNumberCard(undefined)).toBeNull();
  });

  it("colours each part by its kind and keeps the separator, the sequence last", () => {
    expect(submittalNumberCard(segments)).toEqual({
      separator: "-",
      parts: [
        { kind: "project", text: "TWR" },
        { kind: "participant", text: "TMC" },
        { kind: "trade", text: "EL" },
        { kind: "type", text: "MAR" },
        { kind: "sequence", text: "042" },
      ],
      lines: segments.segments,
    });
  });

  it("names a Location part by the item's place at its level, or the item's own place above it", () => {
    const place = ["Zone 1", "Building B1"];
    expect(submittalNumberPlace(1, place)).toBe("Zone 1");
    expect(submittalNumberPlace(2, place)).toBe("Building B1");
    expect(submittalNumberPlace(3, place)).toBe("Building B1");
    expect(submittalNumberPlace(2, [])).toBeNull();
  });
});
