import { expect, userEvent } from "storybook/test";
import { touchTargetShortfall } from "./touch-target.ts";

/** Tab reaches `control` and shows a solid focus ring at least 2px wide. */
export async function expectTabFocusRing(control: Element) {
  await userEvent.tab();
  await expect(control).toHaveFocus();
  const style = getComputedStyle(control);
  await expect(style.outlineStyle).toBe("solid");
  await expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
}

/**
 * The control's touch target is at least 44px across both ways (WCAG 2.5.5,
 * gloved hands on site): its own box, or for a smaller control a hit area that
 * reaches 22px from its centre in all four directions. Edge midpoints, not
 * corners, so rounded corners don't count against it.
 */
export async function expectTouchTarget(control: Element) {
  await expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  await expect(touchTargetShortfall(control)).toBeNull();
}

/** Holds `key` down briefly, as a person does: some components act on focus only while the key is held. */
export async function press(key: string) {
  await userEvent.keyboard(`{${key}>}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await userEvent.keyboard(`{/${key}}`);
}

/** Story parameters for a phone-sized story: the harness renders it 390px wide with a touch screen. */
export const phone = { phone: true } as const;
