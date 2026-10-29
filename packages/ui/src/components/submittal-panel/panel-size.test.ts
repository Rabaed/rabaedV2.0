import { describe, expect, it } from "vitest";
import {
  submittalPanelAvailableWidth,
  submittalPanelBandOf,
  submittalPanelDragWidth,
  submittalPanelMinWidth,
  submittalPanelSizeOf,
  submittalPanelSizes,
  submittalPanelToggledWidth,
  submittalPanelWidthOf,
} from "./panel-size.ts";

describe("the Submittal Panel's sizes (README §2)", () => {
  it("has four presets: Compact 440, Normal 640, Wide 960 and Full", () => {
    expect(submittalPanelSizes.map((p) => [p.key, p.width])).toEqual([
      ["compact", 440],
      ["normal", 640],
      ["wide", 960],
      ["full", "full"],
    ]);
  });

  it("draws a chosen width no narrower than 380px and no wider than the room beside the sidebar", () => {
    expect(submittalPanelMinWidth).toBe(380);
    expect(submittalPanelWidthOf(640, 1102)).toBe(640);
    expect(submittalPanelWidthOf(960, 800)).toBe(800);
    expect(submittalPanelWidthOf(200, 1102)).toBe(380);
    expect(submittalPanelWidthOf("full", 1102)).toBe(1102);
  });

  it("presses the preset the chosen width is, and none for a width in between", () => {
    expect(submittalPanelSizeOf(640)).toBe("normal");
    expect(submittalPanelSizeOf(440)).toBe("compact");
    expect(submittalPanelSizeOf(960)).toBe("wide");
    expect(submittalPanelSizeOf("full")).toBe("full");
    expect(submittalPanelSizeOf(700)).toBeNull();
  });

  it("measures the room from the screen's end to the sidebar's edge, mirrored in Arabic", () => {
    // English: the sidebar is on the left, 264px wide.
    expect(submittalPanelAvailableWidth({ viewport: 1366, sidebar: { left: 0, right: 264 }, dir: "ltr" })).toBe(1102);
    // Arabic: the sidebar is on the right.
    expect(submittalPanelAvailableWidth({ viewport: 1366, sidebar: { left: 1102, right: 1366 }, dir: "rtl" })).toBe(1102);
    // No sidebar (a story, a phone): the whole screen.
    expect(submittalPanelAvailableWidth({ viewport: 1024, sidebar: null, dir: "ltr" })).toBe(1024);
  });
});

describe("dragging the panel's edge", () => {
  const room = { viewport: 1366, available: 1102 };

  it("gives the distance from the pointer to the screen's end, the right in English", () => {
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 700, dir: "ltr" })).toBe(700);
  });

  it("mirrors in Arabic: the panel is on the left, so the width is the pointer's distance from the left", () => {
    expect(submittalPanelDragWidth({ ...room, pointerX: 700, dir: "rtl" })).toBe(700);
  });

  it("snaps to a preset within 12px", () => {
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 651, dir: "ltr" })).toBe(640);
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 629, dir: "ltr" })).toBe(640);
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 653, dir: "ltr" })).toBe(653);
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 950, dir: "ltr" })).toBe(960);
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 430, dir: "ltr" })).toBe(440);
  });

  it("becomes Full within 24px of the most it can be", () => {
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 1078, dir: "ltr" })).toBe("full");
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 1077, dir: "ltr" })).toBe(1077);
    expect(submittalPanelDragWidth({ ...room, pointerX: 0, dir: "ltr" })).toBe("full");
  });

  it("never goes below 380px", () => {
    expect(submittalPanelDragWidth({ ...room, pointerX: 1366 - 100, dir: "ltr" })).toBe(380);
    expect(submittalPanelDragWidth({ ...room, pointerX: 1500, dir: "ltr" })).toBe(380);
  });

  it("toggles Normal and Wide on a double-click: Normal (or near it) becomes Wide, anything else Normal", () => {
    expect(submittalPanelToggledWidth(640)).toBe(960);
    expect(submittalPanelToggledWidth(670)).toBe(960);
    expect(submittalPanelToggledWidth(960)).toBe(640);
    expect(submittalPanelToggledWidth(440)).toBe(640);
    expect(submittalPanelToggledWidth(1102)).toBe(640);
  });
});

describe("the layout bands, by the panel's own width (README §3)", () => {
  it("is Compact below 560, Normal to 879, Wide to 1159 and Full from 1160", () => {
    expect([379, 559, 560, 879, 880, 1159, 1160, 1900].map(submittalPanelBandOf)).toEqual([
      "compact",
      "compact",
      "normal",
      "normal",
      "wide",
      "wide",
      "full",
      "full",
    ]);
  });
});
