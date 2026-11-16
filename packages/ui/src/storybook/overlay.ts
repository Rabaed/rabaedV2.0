import { expect, userEvent } from "storybook/test";

/** Focus starts inside `container`, and Tab and Shift+Tab keep it there however often they are pressed. */
export async function expectFocusTrapped(container: Element) {
  await expect(container.contains(document.activeElement)).toBe(true);
  for (const shift of [false, true]) {
    for (let i = 0; i < 6; i++) {
      await userEvent.tab({ shift });
      await expect({ shift, press: i, inside: container.contains(document.activeElement) }).toEqual({ shift, press: i, inside: true });
    }
  }
}

/** Story parameters for a story that leaves an overlay open: screenshotted as the whole page. */
export const overlay = { overlay: true } as const;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** The pop-up never scrolls sideways, nor makes the page do so. */
async function expectNoSidewaysScroll(panel: HTMLElement) {
  await expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/**
 * On a phone (RP-1312, the owner's Responsive Anatomy, "Modal: full-screen, sticky footer"): the pop-up fills the
 * screen edge to edge, square-cornered, and never scrolls sideways.
 */
export async function expectFullScreen(panel: HTMLElement) {
  const box = panel.getBoundingClientRect();
  await expect({ left: box.left, top: box.top, width: box.width, height: box.height }).toEqual({ left: 0, top: 0, width: innerWidth, height: innerHeight });
  await expect(getComputedStyle(panel).borderTopLeftRadius).toBe("0px");
  await expectNoSidewaysScroll(panel);
}

/**
 * A full-screen pop-up's footer stays at the foot of the screen with every button in view and on top, wherever its
 * body is scrolled (top, middle, end), across the whole width; the primary button is last, at the inline end (the
 * left in Arabic). Scrolls back to the top for the screenshot.
 */
export async function expectFooterPinned(panel: HTMLElement) {
  const footer = panel.querySelector<HTMLElement>("[data-dialog-footer]");
  await expect(footer).not.toBeNull();
  const buttons = [...footer!.querySelectorAll<HTMLElement>("button, a[href]")];
  await expect(buttons.length).toBeGreaterThan(0);
  const scrollable = panel.scrollHeight - panel.clientHeight;
  for (const top of [0, scrollable / 2, scrollable]) {
    panel.scrollTop = top;
    await nextFrame();
    const box = footer!.getBoundingClientRect();
    await expect({ top, bottom: Math.round(box.bottom) }).toEqual({ top, bottom: innerHeight });
    await expect(box.width).toBeGreaterThanOrEqual(panel.clientWidth);
    for (const button of buttons) {
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      await expect({ top, name: button.textContent, onTop: hit !== null && button.contains(hit) }).toEqual({ top, name: button.textContent, onTop: true });
    }
  }
  if (buttons.length > 1) {
    const [primary, other] = [buttons[buttons.length - 1]!.getBoundingClientRect(), buttons[0]!.getBoundingClientRect()];
    const rtl = getComputedStyle(panel).direction === "rtl";
    await expect(rtl ? primary.right <= other.left : primary.left >= other.right).toBe(true);
  }
  panel.scrollTop = 0;
  await nextFrame();
  await expectNoSidewaysScroll(panel);
}

/** A short confirm or cancel on a phone, and every pop-up from 768 wide: a centred card with rounded corners, the page around it. */
export async function expectCard(panel: HTMLElement) {
  const box = panel.getBoundingClientRect();
  await expect(box.width).toBeLessThan(innerWidth);
  await expect(box.height).toBeLessThan(innerHeight);
  await expect(Math.abs(box.left - (innerWidth - box.right))).toBeLessThanOrEqual(1);
  await expect(getComputedStyle(panel).borderTopLeftRadius).not.toBe("0px");
  await expectNoSidewaysScroll(panel);
}
