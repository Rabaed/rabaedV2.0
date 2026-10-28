import { submittalPanelNormalWidth } from "./panel-preferences.ts";

/**
 * The Submittal Panel's sizes (spec RP-1054, RP-1063, README §2 and §3): four presets, a drag edge
 * that snaps to them, and the layout bands the panel's own width falls in. Pure, so the hook and
 * the switch (`panel-resize.tsx`) only measure and draw.
 */

export type SubmittalPanelSize = "compact" | "normal" | "wide" | "full";

/** A chosen width: px, or "full" (to the sidebar's edge), as it is kept. */
export type SubmittalPanelWidth = number | "full";

/** The presets, narrowest first, each with how much of its rectangle glyph is filled (README §2). */
export const submittalPanelSizes: readonly { key: SubmittalPanelSize; width: SubmittalPanelWidth; fill: number }[] = [
  { key: "compact", width: 440, fill: 28 },
  { key: "normal", width: submittalPanelNormalWidth, fill: 45 },
  { key: "wide", width: 960, fill: 65 },
  { key: "full", width: "full", fill: 100 },
];

export const submittalPanelMinWidth = 380;
const wideWidth = 960;

/** A drag this close to a preset lands on it. */
const snapDistance = 12;
/** A drag this close to the most the panel can be becomes Full. */
const fullDistance = 24;
/** A double-click this close to Normal goes Wide (drawer.js). */
const normalDistance = 40;

/** The width drawn for a chosen one: at least 380px, at most the room beside the sidebar. */
export function submittalPanelWidthOf(chosen: SubmittalPanelWidth, available: number): number {
  if (chosen === "full") return available;
  return Math.min(Math.max(submittalPanelMinWidth, chosen), available);
}

/** The preset a chosen width is (its button is pressed), or null for a width in between. */
export function submittalPanelSizeOf(chosen: SubmittalPanelWidth): SubmittalPanelSize | null {
  return submittalPanelSizes.find((p) => p.width === chosen)?.key ?? null;
}

/** The room for the panel: from the screen's inline-end to the sidebar's edge (the whole screen without one). */
export function submittalPanelAvailableWidth({
  viewport,
  sidebar,
  dir,
}: {
  viewport: number;
  sidebar: { left: number; right: number } | null;
  dir: "ltr" | "rtl";
}): number {
  if (!sidebar) return viewport;
  return Math.round(dir === "rtl" ? sidebar.left : viewport - sidebar.right);
}

/**
 * The width a drag of the inline-start edge gives (drawer.js): the pointer's distance from the
 * screen's inline-end, the right in English and the left in Arabic, at least 380px; Full within
 * 24px of the room, a preset within 12px of it.
 */
export function submittalPanelDragWidth({
  pointerX,
  viewport,
  available,
  dir,
}: {
  pointerX: number;
  viewport: number;
  available: number;
  dir: "ltr" | "rtl";
}): SubmittalPanelWidth {
  const width = Math.round(Math.min(Math.max(submittalPanelMinWidth, dir === "rtl" ? pointerX : viewport - pointerX), available));
  if (width >= available - fullDistance) return "full";
  const snapped = submittalPanelSizes.find((p) => p.width !== "full" && Math.abs(p.width - width) <= snapDistance);
  return snapped ? snapped.width : width;
}

/** A double-click on the edge: Normal (or near it) goes Wide, any other width back to Normal. */
export function submittalPanelToggledWidth(width: number): number {
  return Math.abs(width - submittalPanelNormalWidth) < normalDistance ? wideWidth : submittalPanelNormalWidth;
}

/** The layout band a drawn width falls in (README §3); the band CSS in `submittal-panel.css` uses the same edges. */
export function submittalPanelBandOf(width: number): SubmittalPanelSize {
  if (width >= 1160) return "full";
  if (width >= 880) return "wide";
  if (width >= 560) return "normal";
  return "compact";
}
