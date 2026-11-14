import { describe, expect, it } from "vitest";
import { grantable, impliedBySelection, pickable, treeOrder } from "./dimension-tree.ts";

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

describe("pickable (RP-1239)", () => {
  const a = (id: string, active: boolean, parentId: string | null = null) => ({ id, parentId, active });
  const all = [a("T1", true), a("T2", false), a("BA", false, "T2"), a("F1", true, "T1")];

  it("offers active values only, for a new pick", () => {
    expect(pickable(all, new Set()).map((x) => x.id)).toEqual(["T1", "F1"]);
  });

  it("keeps an archived value the grant already covers, so it can be unticked", () => {
    expect(pickable(all, new Set(["BA"])).map((x) => x.id)).toEqual(["T1", "BA", "F1"]);
  });
});

describe("grantable", () => {
  const value = (id: string, wholeProject = false) => ({
    id,
    parentId: null,
    depth: 1,
    levelName: null,
    code: id,
    name: { en: id, ar: id },
    active: true,
    ...(wholeProject ? { wholeProject: true as const } : {}),
  });

  it("leaves out the Whole Project Location: any Location covers it, so no grant lists it and the Settings tree edits it not (RP-1304)", () => {
    const dimensions = { trade: [value("EL"), value("ME")], location: [value("WP", true), value("BA"), value("BB")] };
    expect(grantable(dimensions)).toEqual({ trade: [value("EL"), value("ME")], location: [value("BA"), value("BB")] });
  });
});
