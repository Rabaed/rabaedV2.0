import { describe, expect, it } from "vitest";
import { impliedBySelection, treeOrder } from "./dimension-tree.ts";

const v = (id: string, parentId: string | null = null) => ({ id, parentId });
// As the API lists them: by depth, then sort.
const values = [v("T1"), v("T2"), v("BA", "T1"), v("BB", "T1"), v("F1", "BA")];

describe("treeOrder", () => {
  it("puts each Location right after its parent, indented one level deeper", () => {
    expect(treeOrder(values).map((x) => [x.id, x.level])).toEqual([
      ["T1", 0],
      ["BA", 1],
      ["F1", 2],
      ["BB", 1],
      ["T2", 0],
    ]);
  });

  it("starts from whatever is top-most when only part of the tree is given", () => {
    expect(treeOrder([v("BA", "T1"), v("F1", "BA")]).map((x) => [x.id, x.level])).toEqual([
      ["BA", 0],
      ["F1", 1],
    ]);
  });
});

describe("impliedBySelection", () => {
  it("is everything beneath a selected Location", () => {
    expect([...impliedBySelection(values, new Set(["T1"]))].sort()).toEqual(["BA", "BB", "F1"]);
    expect([...impliedBySelection(values, new Set(["BA", "T2"]))]).toEqual(["F1"]);
  });
});
