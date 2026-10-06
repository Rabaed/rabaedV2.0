/**
 * The touch-target measure the story harness runs on every phone story (src/storybook/touch-target.ts),
 * checked on plain markup in the same real browser.
 */
import { afterEach, describe, expect, test } from "vitest";
import { touchTargetOffenders } from "../src/storybook/touch-target.ts";

function render(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("touchTargetOffenders", () => {
  test("passes a 44px button", () => {
    const root = render(`<button style="inline-size: 44px; block-size: 44px">Go</button>`);
    expect(touchTargetOffenders(root)).toEqual([]);
  });

  test("flags a small button", () => {
    const root = render(`<div style="padding: 100px"><button style="inline-size: 20px; block-size: 20px; padding: 0">x</button></div>`);
    expect(touchTargetOffenders(root)).toHaveLength(1);
  });

  test("exempts a link inside a sentence", () => {
    const root = render(`<p>Read the <a href="#terms">terms</a> before you sign.</p>`);
    expect(touchTargetOffenders(root)).toEqual([]);
  });

  test("exempts a link inside inline markup inside a sentence", () => {
    const root = render(`<p>Read the <strong><a href="#terms">terms</a></strong> before you sign.</p>`);
    expect(touchTargetOffenders(root)).toEqual([]);
  });

  test("flags a row link beside a badge: a row, not a sentence", () => {
    const root = render(`<div style="padding: 100px"><a href="#item">MS-001</a> <span>Approved</span></div>`);
    expect(touchTargetOffenders(root)).toEqual([expect.stringMatching(/^a "MS-001"/)]);
  });

  test("flags a small control at the screen edge, where the probe past the edge finds nothing", () => {
    const root = render(
      `<button aria-label="Close" style="position: fixed; inset-block-start: 0; inset-inline-start: 0; inline-size: 20px; block-size: 20px; padding: 0"></button>`,
    );
    expect(touchTargetOffenders(root)).toEqual([expect.stringMatching(/at the screen edge/)]);
  });
});
