import { describe, expect, it } from "vitest";
import { projectTileClasses, projectTileIndex, projectTileIndexes } from "./project-tile.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("a Project's tile colour", () => {
  it("is stable: a known id keeps its colour from release to release (pinned literals)", () => {
    expect(projectTileIndex("a7823e0f-3d4f-4fb9-8307-f7c82c61096c")).toBe(3);
    expect(projectTileIndex("00000000-0000-4000-8000-000000000001")).toBe(0);
  });

  it("uses every colour of the palette across many ids, and nothing outside it", () => {
    const used = new Set<number>();
    for (const id of ids(200)) {
      const index = projectTileIndex(id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(projectTileClasses.length);
      used.add(index);
    }
    expect(used.size).toBe(projectTileClasses.length);
  });
});

describe("tile colours down a list", () => {
  it("never repeat the colour of the card before", () => {
    const list = ids(300);
    const indexes = projectTileIndexes(list);
    for (let i = 1; i < indexes.length; i++) expect(indexes[i]).not.toBe(indexes[i - 1]);
  });

  it("leave a Project its own colour when the card before differs, and the first card always", () => {
    const list = ids(60);
    const indexes = projectTileIndexes(list);
    expect(indexes[0]).toBe(projectTileIndex(list[0]!));
    list.forEach((id, i) => {
      if (i > 0 && projectTileIndex(id) !== indexes[i - 1]) expect(indexes[i]).toBe(projectTileIndex(id));
    });
  });

  it("repeat a Project's colour from one showing of the same list to the next", () => {
    expect(projectTileIndexes(ids(20))).toEqual(projectTileIndexes(ids(20)));
  });
});
