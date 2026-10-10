import { describe, expect, it } from "vitest";
import { projectTileClasses, projectTileIndex } from "./project-tile.ts";

describe("a Project's tile colour", () => {
  it("is stable: the same id always gets the same colour", () => {
    const id = "0b0b3c0e-6e1c-4f4e-9a52-3f3a3e0d9b11";
    expect(projectTileIndex(id)).toBe(projectTileIndex(id));
    // A known id keeps its colour from release to release (pinned literals).
    expect(projectTileIndex("a7823e0f-3d4f-4fb9-8307-f7c82c61096c")).toBe(3);
    expect(projectTileIndex("00000000-0000-4000-8000-000000000001")).toBe(0);
  });

  it("uses every colour of the palette across many ids, and nothing outside it", () => {
    const used = new Set<number>();
    for (let n = 0; n < 200; n++) {
      const index = projectTileIndex(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(projectTileClasses.length);
      used.add(index);
    }
    expect(used.size).toBe(projectTileClasses.length);
  });
});
