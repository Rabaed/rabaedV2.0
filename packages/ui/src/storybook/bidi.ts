import { expect } from "storybook/test";

/**
 * Asserts that `element`'s text is laid out left to right on screen: every
 * character sits to the right of the one before it. Measures the rendered
 * glyphs, so it catches bidi reordering (e.g. a Document Number scrambled
 * inside an Arabic sentence) whatever the markup says.
 */
export async function expectLaidOutLeftToRight(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const lefts: number[] = [];
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let i = 0; i < node.length; i++) {
      if (/\s/.test(node.data[i]!)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      lefts.push(range.getBoundingClientRect().left);
    }
  }
  await expect(lefts.length).toBeGreaterThan(1);
  await expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
}
