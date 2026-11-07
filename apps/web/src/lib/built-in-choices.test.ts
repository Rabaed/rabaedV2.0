import type { DimensionValue, DimensionValues, WorkItemDetail } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { fillingChoices } from "./built-in-choices.ts";

const b = (en: string) => ({ en, ar: en });
const value = (id: string, active: boolean): DimensionValue => ({ id, parentId: null, depth: 1, levelName: null, code: id.toUpperCase(), name: b(id), active });
const covered: DimensionValues = { trade: [value("el", true), value("me", false)], location: [value("ba", true), value("bb", false)] };

describe("fillingChoices (RP-1239)", () => {
  it("offers no archived Trade or Location for a new item", () => {
    const choices = fillingChoices(covered, [], "en");
    expect(choices.trades.map((t) => t.id)).toEqual(["el"]);
    expect(choices.locations.map((l) => l.id)).toEqual(["ba"]);
  });

  it("keeps an item's own archived Trade and Location", () => {
    const item = { trade: { id: "me", code: "ME", name: b("me") }, location: { id: "bb", code: "BB", name: b("bb") }, scopes: [] } as unknown as WorkItemDetail;
    const choices = fillingChoices(covered, [], "en", item);
    expect(choices.trades.map((t) => t.id)).toEqual(["el", "me"]);
    expect(choices.locations.map((l) => l.id)).toEqual(["ba", "bb"]);
  });
});
