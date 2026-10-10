import { describe, expect, it } from "vitest";
import { defaultListColumns, listColumnLayout, listColumns } from "./list-columns.ts";

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
