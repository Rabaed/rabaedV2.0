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
