import { expect, userEvent } from "storybook/test";

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
  const box = control.getBoundingClientRect();
  if (box.width >= 44 && box.height >= 44) return;
  // A smaller control must extend its hit area (e.g. a pseudo-element); probe where it should reach.
  const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
  const reach = 21.5;
  for (const [dx, dy] of [[-reach, 0], [reach, 0], [0, -reach], [0, reach]] as const) {
    const hit = document.elementFromPoint(x + dx, y + dy);
    const at = { control: describe(control), dx, dy };
    await expect({ ...at, hit: hit && control.contains(hit) ? describe(control) : describe(hit) }).toEqual({ ...at, hit: describe(control) });
  }
}

function describe(element: Element | null) {
  if (!element) return "nothing";
  const name = element.getAttribute("aria-label") ?? element.id ?? "";
  return `<${element.tagName.toLowerCase()} ${element.getAttribute("role") ?? ""} ${name}> ${element.textContent?.slice(0, 30) ?? ""}`;
}

/** Holds `key` down briefly, as a person does: some components act on focus only while the key is held. */
export async function press(key: string) {
  await userEvent.keyboard(`{${key}>}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await userEvent.keyboard(`{/${key}}`);
}

/** Story parameters for a phone-sized story: the harness renders it 390px wide with a touch screen. */
export const phone = { phone: true } as const;
