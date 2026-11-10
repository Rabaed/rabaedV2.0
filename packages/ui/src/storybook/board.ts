import { expect, waitFor } from "storybook/test";

// Checks shared by the boards' tablet and phone stories (RP-1274): the Submittals Kanban, the Snag
// list board and the Packages board snap to each column, scroll each column on its own, and on a
// phone show one column with the next one peeking (RP-1158 rows 48, 49, 67).

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** Where the board's content starts: its start padding inside its start edge (the right in Arabic). */
function contentStart(region: HTMLElement) {
  const box = region.getBoundingClientRect();
  const style = getComputedStyle(region);
  return style.direction === "rtl" ? box.right - parseFloat(style.paddingRight) : box.left + parseFloat(style.paddingLeft);
}

/** A column's start edge: its left in English, its right in Arabic. */
function startEdge(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return getComputedStyle(element).direction === "rtl" ? box.right : box.left;
}

/**
 * The board scrolls sideways one column at a time: it snaps to each column's start, in the reading
 * direction. A sideways nudge lands the next column's start on the board's start, right to left in Arabic,
 * or, where the board can't scroll that far (its last columns all fit), its end.
 */
export async function expectSnapsByColumn(region: HTMLElement, columns: HTMLElement[]) {
  await expect(getComputedStyle(region).scrollSnapType).toBe("x mandatory");
  for (const column of columns) await expect(getComputedStyle(column).scrollSnapAlign).toBe("start");
  const rtl = getComputedStyle(region).direction === "rtl";
  // A small nudge towards the second column, as a short swipe: the board settles with that column at its start.
  region.scrollBy({ left: (rtl ? -1 : 1) * 120, behavior: "instant" });
  const end = region.scrollWidth - region.clientWidth;
  await waitFor(async () => {
    const atEnd = Math.abs(region.scrollLeft) >= end - 1;
    await expect(atEnd || Math.abs(startEdge(columns[1]!) - contentStart(region)) <= 1).toBe(true);
    await expect(Math.abs(region.scrollLeft)).not.toBe(120);
  });
  region.scrollTo({ left: 0, behavior: "instant" });
  await frame();
}

/**
 * The board doesn't scroll down; a column with more cards than fit scrolls them on its own, its
 * header staying where it is.
 */
export async function expectColumnScrollsOnItsOwn(region: HTMLElement, column: HTMLElement, header: HTMLElement) {
  await expect(region.scrollHeight).toBeLessThanOrEqual(region.clientHeight);
  const scroller = [...column.querySelectorAll<HTMLElement>("*")].find((e) => getComputedStyle(e).overflowY === "auto" && e.scrollHeight > e.clientHeight);
  await expect(scroller).toBeDefined();
  await expect(column.getBoundingClientRect().bottom).toBeLessThanOrEqual(region.getBoundingClientRect().bottom);
  const top = header.getBoundingClientRect().top;
  scroller!.scrollTop = 200;
  await frame();
  await expect(scroller!.scrollTop).toBeGreaterThan(0);
  await expect(header.getBoundingClientRect().top).toBe(top);
  scroller!.scrollTop = 0;
}

/**
 * On a phone a column is the board's width less 40 px, so the first fills the screen and about 40 px
 * of the next one shows at its end; the page itself never scrolls sideways.
 */
export async function expectOneColumnAndAPeek(region: HTMLElement, columns: HTMLElement[]) {
  const style = getComputedStyle(region);
  const content = region.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const first = columns[0]!.getBoundingClientRect();
  await expect(Math.round(first.width)).toBe(Math.round(content - 40));
  const box = region.getBoundingClientRect();
  await expect(first.left).toBeGreaterThanOrEqual(box.left);
  await expect(first.right).toBeLessThanOrEqual(box.right);
  const next = columns[1]!.getBoundingClientRect();
  const peek = style.direction === "rtl" ? next.right - box.left : box.right - next.left;
  await expect(peek).toBeGreaterThanOrEqual(32);
  await expect(peek).toBeLessThanOrEqual(48);
  const page = document.scrollingElement!;
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
}

/** The middle of an element, in the window. */
export function centreOf(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

const touch = (type: string, at: { x: number; y: number }) =>
  new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true, composed: true });

/** A finger down on `element`, at its middle. */
export function fingerDown(element: Element, at = centreOf(element)) {
  element.dispatchEvent(touch("pointerdown", at));
  return at;
}

/** The finger moves to `at`: the move is sent to whatever is under it, as a browser does with a touch. */
export function fingerMove(at: { x: number; y: number }) {
  (document.elementFromPoint(at.x, at.y) ?? document.body).dispatchEvent(touch("pointermove", at));
}

/** The finger lifts at `at`; a tap's click follows on what was pressed when `click` is given. */
export function fingerUp(at: { x: number; y: number }, click?: HTMLElement) {
  (document.elementFromPoint(at.x, at.y) ?? document.body).dispatchEvent(touch("pointerup", at));
  click?.click();
}

/** Holds the finger still for `ms`. */
export const hold = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
