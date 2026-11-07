import { describe, expect, it } from "vitest";
import { backLinkGoes, previousEntryOf, type BackClick } from "./back-link.tsx";

const origin = "https://app.rabaed.sa";
const plain: BackClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe("backLinkGoes", () => {
  it("goes back in history when the page before, in this tab, was inside Rabaed", () => {
    expect(backLinkGoes(plain, `${origin}/en/projects/p1/work-items?stage=open`, origin)).toBe("history");
  });

  it("goes to the fixed parent when there is no page before in this tab (a new tab, a link from an email)", () => {
    expect(backLinkGoes(plain, null, origin)).toBe("parent");
  });

  it("goes to the fixed parent when the page before was on another site", () => {
    expect(backLinkGoes(plain, "https://mail.example.com/inbox", origin)).toBe("parent");
    expect(backLinkGoes(plain, "https://app.rabaed.sa.example.com/en", origin)).toBe("parent");
    expect(backLinkGoes(plain, "http://app.rabaed.sa/en", origin)).toBe("parent");
  });

  it("goes to the fixed parent when the page before can't be read as a URL", () => {
    expect(backLinkGoes(plain, "not a url", origin)).toBe("parent");
  });

  it("leaves a middle-click, or a click with ctrl, cmd, shift or alt, to the link: it opens the parent", () => {
    const previous = `${origin}/en/packages/k1`;
    expect(backLinkGoes({ ...plain, button: 1 }, previous, origin)).toBe("parent");
    expect(backLinkGoes({ ...plain, ctrlKey: true }, previous, origin)).toBe("parent");
    expect(backLinkGoes({ ...plain, metaKey: true }, previous, origin)).toBe("parent");
    expect(backLinkGoes({ ...plain, shiftKey: true }, previous, origin)).toBe("parent");
    expect(backLinkGoes({ ...plain, altKey: true }, previous, origin)).toBe("parent");
  });

  it("leaves a click another handler already took to the link", () => {
    expect(backLinkGoes({ ...plain, defaultPrevented: true }, `${origin}/en`, origin)).toBe("parent");
  });
});

describe("previousEntryOf", () => {
  const entries = [{ url: `${origin}/en/projects/p1/work-items` }, { url: `${origin}/en/work-items/w1` }, { url: `${origin}/en/work-items/w1/links/l1` }];
  const at = (index: number) => ({ currentEntry: { index }, entries: () => entries });

  it("is the entry before the current one in this tab", () => {
    expect(previousEntryOf(at(2))).toBe(`${origin}/en/work-items/w1`);
    expect(previousEntryOf(at(1))).toBe(`${origin}/en/projects/p1/work-items`);
  });

  it("is null on the tab's first entry (a new tab, or the first Rabaed page after another site)", () => {
    expect(previousEntryOf(at(0))).toBeNull();
  });

  it("is null without the Navigation API, or with no current entry", () => {
    expect(previousEntryOf(undefined)).toBeNull();
    expect(previousEntryOf({ currentEntry: null, entries: () => entries })).toBeNull();
  });
});
