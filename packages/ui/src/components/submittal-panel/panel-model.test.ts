import { describe, expect, it } from "vitest";
import { submittalPanelKey, submittalPanelNumber, submittalPanelPosition, submittalPanelWith } from "./panel-model.ts";

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };
const en = (s: string) => b(s);

describe("the Submittal Panel's With (V14, gap A3)", () => {
  it("names another Company by its name only, with no person", () => {
    // The item read gives another Company's holder with no member and no pool.
    const heldBy = { companyName: en("Design Consultants"), memberName: null, pool: null };
    expect(submittalPanelWith(heldBy, "en")).toEqual({ kind: "company", name: "Design Consultants" });
  });

  it("names the viewer's own Company's person (the positive control)", () => {
    const heldBy = { companyName: en("TMC Constructions"), memberName: en("Hafiz Hamdan"), pool: null };
    expect(submittalPanelWith(heldBy, "en")).toEqual({ kind: "person", name: "Hafiz Hamdan" });
  });

  it("shows up to 3 names of an own Step Pool, in the reader's order, then how many more", () => {
    const heldBy = { companyName: en("TMC"), memberName: null, pool: { names: ["Sara", "Ali", "Hafiz", "Badr", "Omar"].map(en) } };
    expect(submittalPanelWith(heldBy, "en")).toEqual({ kind: "pool", names: ["Ali", "Badr", "Hafiz"], more: 2 });
  });

  it("reads 'Owner review' as the API gives it, as a Company name (ADR 0022)", () => {
    const heldBy = { companyName: b("Owner review", "مراجعة المالك"), memberName: null, pool: null };
    expect(submittalPanelWith(heldBy, "ar")).toEqual({ kind: "company", name: "مراجعة المالك" });
  });

  it("is with nobody once closed", () => {
    expect(submittalPanelWith(null, "en")).toBeNull();
  });
});

describe("the panel's place among the loaded rows (gap C6)", () => {
  const ids = ["a", "b", "c"];
  it("counts n / m over the loaded rows and offers the neighbours", () => {
    expect(submittalPanelPosition(ids, "b")).toEqual({ index: 1, total: 3, previous: "a", next: "c" });
  });
  it("stops at the edges", () => {
    expect(submittalPanelPosition(ids, "a")).toEqual({ index: 0, total: 3, previous: null, next: "b" });
    expect(submittalPanelPosition(ids, "c")).toEqual({ index: 2, total: 3, previous: "b", next: null });
  });
  it("has no place for an item not on the loaded page (a shared link)", () => {
    expect(submittalPanelPosition(ids, "z")).toEqual({ index: -1, total: 3, previous: null, next: null });
  });
});

describe("the panel's keys (README §1)", () => {
  const key = (k: string, more: Partial<Parameters<typeof submittalPanelKey>[0]> = {}) =>
    submittalPanelKey({ key: k, modifier: false, defaultPrevented: false, typing: false, inWidget: false, layerOpen: false, ...more });
  it("closes on Esc, and moves on ↑ / ↓", () => {
    expect(key("Escape")).toBe("close");
    expect(key("ArrowUp")).toBe("previous");
    expect(key("ArrowDown")).toBe("next");
    expect(key("Enter")).toBeNull();
  });
  it("leaves Esc to an inner layer (an Action Form, a menu) that is open or took it", () => {
    expect(key("Escape", { layerOpen: true })).toBeNull();
    expect(key("Escape", { defaultPrevented: true })).toBeNull();
  });
  it("leaves ↑ / ↓ to a field being typed in, a menu or list that moves by them, and to a modifier", () => {
    expect(key("ArrowDown", { typing: true })).toBeNull();
    // Esc in a search box clears or leaves the box, as the design does: the panel stays.
    expect(key("Escape", { typing: true })).toBeNull();
    expect(key("ArrowDown", { inWidget: true })).toBeNull();
    expect(key("ArrowUp", { modifier: true })).toBeNull();
    expect(key("ArrowUp", { layerOpen: true })).toBeNull();
  });
});

describe("the panel's number (gap A16)", () => {
  it("splits a Revision's stored ' Rev n' off, so DocNo words it in the reader's language, inline", () => {
    expect(submittalPanelNumber("TWR-TMC-CV-DAR-282 Rev 1", 1)).toEqual({ number: "TWR-TMC-CV-DAR-282", revisionNo: 1 });
  });
  it("shows nothing for Rev 0", () => {
    expect(submittalPanelNumber("TWR-TMC-CV-DAR-282", 0)).toEqual({ number: "TWR-TMC-CV-DAR-282", revisionNo: null });
  });
  it("has no number for a Draft", () => {
    expect(submittalPanelNumber(null, 0)).toBeNull();
  });
});
