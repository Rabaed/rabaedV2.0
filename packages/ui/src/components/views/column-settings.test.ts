import { defaultListColumns } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { moveColumn } from "./column-settings.tsx";

const keys = (layout: typeof defaultListColumns) => layout.map((c) => c.key);

describe("moving a List column (RP-409)", () => {
  it("puts it where it was dropped", () => {
    const moved = keys(moveColumn(defaultListColumns, 10, 2));
    expect(moved.slice(0, 4)).toEqual(["documentNumber", "subject", "owner", "revision"]);
    expect(moved).toHaveLength(defaultListColumns.length);
  });

  it("never above or onto the locked Document Number and Subject", () => {
    expect(moveColumn(defaultListColumns, 5, 0)).toBe(defaultListColumns);
    expect(moveColumn(defaultListColumns, 1, 6)).toBe(defaultListColumns);
  });

  it("goes no further than the last column", () => {
    expect(moveColumn(defaultListColumns, 13, 14)).toBe(defaultListColumns);
  });
});
