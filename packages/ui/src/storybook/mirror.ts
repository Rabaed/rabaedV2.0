import type { Locale } from "@rabaed/domain";
import { expect } from "storybook/test";

/** A side of the screen an arrow or chevron points to. */
export type ScreenSide = "left" | "right";

/** An icon is mirrored when it renders flipped on the horizontal axis (Icon's `mirrorInRtl`). */
export function isMirrored(icon: Element): boolean {
  const { scale, transform } = getComputedStyle(icon);
  return scale.startsWith("-1") || transform.startsWith("matrix(-1");
}

/**
 * Which way a left or right arrow or chevron points on screen: its drawing (Tabler's `-left` or
 * `-right` class), turned round when it is mirrored (RP-1114: an icon picked by locale and then
 * mirrored again points against the flow). Any other icon throws, so a swapped icon can't pass.
 */
export function pointsTo(icon: Element): ScreenSide {
  const drawn = /tabler-icon-\S*-(left|right)\b/.exec(icon.getAttribute("class") ?? "")?.[1] as ScreenSide | undefined;
  if (!drawn) throw new Error(`Not a left or right icon: ${icon.getAttribute("class")}`);
  return isMirrored(icon) ? opposite(drawn) : drawn;
}

function opposite(side: ScreenSide): ScreenSide {
  return side === "left" ? "right" : "left";
}

/** The way the reading goes, which a "next" chevron points: left in Arabic, right in English. */
export function forwardIn(locale: Locale): ScreenSide {
  return locale === "ar" ? "left" : "right";
}

/** The way back, which a Back chevron points: right in Arabic, left in English. */
export function backIn(locale: Locale): ScreenSide {
  return opposite(forwardIn(locale));
}

/** At least one icon, and every one points on along the reading direction. */
export async function expectAlongTheFlow(icons: readonly Element[], locale: Locale) {
  await expect(icons.length).toBeGreaterThan(0);
  await expect(icons.map(pointsTo)).toEqual(icons.map(() => forwardIn(locale)));
}
