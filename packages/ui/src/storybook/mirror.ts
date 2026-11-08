import type { Locale } from "@rabaed/domain";

/** An icon is mirrored when it renders flipped on the horizontal axis (Icon's `mirrorInRtl`). */
export function isMirrored(icon: Element): boolean {
  const { scale, transform } = getComputedStyle(icon);
  return scale.startsWith("-1") || transform.startsWith("matrix(-1");
}

/**
 * Which way a left or right arrow or chevron points on screen: its drawing (Tabler's `-left` or
 * `-right` class), turned round when it is mirrored (RP-1114: an icon picked by locale and then
 * mirrored again points against the flow).
 */
export function pointsTo(icon: Element): "left" | "right" {
  const drawn = /tabler-icon-\S*-left\b/.test(icon.getAttribute("class") ?? "") ? "left" : "right";
  if (!isMirrored(icon)) return drawn;
  return drawn === "left" ? "right" : "left";
}

/** The way the reading goes, which a "next" chevron points: left in Arabic, right in English. */
export function forwardIn(locale: Locale): "left" | "right" {
  return locale === "ar" ? "left" : "right";
}
