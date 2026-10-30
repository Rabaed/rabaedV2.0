import { expect } from "storybook/test";

/**
 * A board that fills the window (RP-1092): its region runs from under what sits above it to the
 * window's bottom edge, so its sideways scrollbar sits on that edge; it scrolls down inside
 * itself and sideways, and the page itself scrolls neither way.
 */
export async function expectFillsTheWindow(region: HTMLElement, above: HTMLElement) {
  const box = region.getBoundingClientRect();
  await expect(Math.round(box.bottom)).toBe(innerHeight);
  await expect(box.top).toBeGreaterThanOrEqual(above.getBoundingClientRect().bottom);
  await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
  await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
  const page = document.scrollingElement!;
  await expect(page.scrollHeight).toBeLessThanOrEqual(page.clientHeight);
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
}
