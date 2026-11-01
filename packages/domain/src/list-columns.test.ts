import { describe, expect, it } from "vitest";
import { defaultListColumns, layoutToSave, listColumnLayout, listColumns } from "./list-columns.ts";

const shown = (layout: { key: string; shown: boolean }[]) => layout.filter((c) => c.shown).map((c) => c.key);

describe("the List's columns (RP-409)", () => {
  it("start as the owner's design draws them, 12 of 14 shown, with no Due date", () => {
    expect(defaultListColumns.map((c) => c.key)).toEqual([
      "documentNumber",
      "subject",
      "revision",
      "trade",
      "type",
      "stage",
      "outcome",
      "locationLevel1",
      "locationLevel2",
      "locationLevel3",
      "owner",
      "contractor",
      "created",
      "stepAge",
    ]);
    expect(shown(defaultListColumns)).toHaveLength(12);
    expect(shown(defaultListColumns)).not.toContain("contractor");
    expect(shown(defaultListColumns)).not.toContain("stepAge");
  });

  // RP-1177 (UX-04, the owner's answer of 2026-11-02): below 1600 wide the first order puts the Code and the holder
  // ("With") right after the Status, so they fit at 1366 without scrolling; a Member's saved layout stays theirs.
  it("start narrow with the Code and the holder right after the Status, and keep a saved layout as it is", () => {
    expect(listColumns(null, { narrow: true }).map((c) => c.key)).toEqual([
      "documentNumber",
      "subject",
      "revision",
      "trade",
      "type",
      "stage",
      "outcome",
      "owner",
      "locationLevel1",
      "locationLevel2",
      "locationLevel3",
      "contractor",
      "created",
      "stepAge",
    ]);
    expect(shown(listColumns(null, { narrow: true }))).toHaveLength(12);
    expect(listColumns(null, { narrow: false })).toEqual(listColumns(null));
    const saved = listColumns(null).map((c) => (c.key === "locationLevel1" ? { ...c, shown: false } : c));
    expect(listColumns(saved, { narrow: true })).toEqual(listColumns(saved));
  });

  // The owner's answer of 2026-11-02: "Save as my default" under 1600 keeps the design's order when the Member moved
  // nothing, so wide screens still show the anatomy's; a switch they turned is kept, and so is an order they made.
  it("are kept in the design's order when saved from the narrow first order, the switches as set", () => {
    const narrow = listColumns(null, { narrow: true }).map((c) => (c.key === "contractor" ? { ...c, shown: true } : c));
    expect(layoutToSave(narrow)).toEqual(listColumns(null).map((c) => (c.key === "contractor" ? { ...c, shown: true } : c)));
    const moved = [narrow[0]!, narrow[1]!, narrow[7]!, ...narrow.slice(2, 7), ...narrow.slice(8)];
    expect(layoutToSave(moved)).toEqual(moved);
    expect(layoutToSave(listColumns(null))).toEqual(listColumns(null));
  });

  it("keep a Member's order and switches, the Document Number and Subject always first and shown", () => {
    const saved = [
      { key: "owner" as const, shown: true },
      { key: "subject" as const, shown: false },
      { key: "stepAge" as const, shown: true },
      { key: "revision" as const, shown: false },
    ];
    const layout = listColumns(saved);
    expect(layout.slice(0, 2)).toEqual([
      { key: "documentNumber", shown: true },
      { key: "subject", shown: true },
    ]);
    expect(layout.map((c) => c.key).indexOf("owner")).toBeLessThan(layout.map((c) => c.key).indexOf("stepAge"));
    expect(layout.find((c) => c.key === "revision")?.shown).toBe(false);
    expect(layout).toHaveLength(14);
  });

  it("put a column a saved layout lacks after the one before it in the first order", () => {
    const layout = listColumns([
      { key: "trade", shown: true },
      { key: "revision", shown: true },
    ]).map((c) => c.key);
    expect(layout.indexOf("type")).toBe(layout.indexOf("trade") + 1);
  });

  it("are refused twice over, or by a name that isn't a column", () => {
    expect(listColumnLayout.safeParse([{ key: "owner", shown: true }, { key: "owner", shown: false }]).success).toBe(false);
    expect(listColumnLayout.safeParse([{ key: "dueDate", shown: true }]).success).toBe(false);
    expect(listColumnLayout.safeParse(defaultListColumns).success).toBe(true);
  });
});
