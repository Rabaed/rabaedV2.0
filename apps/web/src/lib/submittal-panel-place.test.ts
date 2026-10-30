import type { WorkItemList } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalPanelPlace } from "./submittal-panel-place.ts";

// The open item's place in the Submittal Panel (RP-1065): its Location path as the List's
// locations name it. The number card's Location line names a level only from that path.

type Location = WorkItemList["filters"]["locations"][number];

const zone: Location = { id: "11111111-1111-4111-8111-111111111111", code: "Z1", name: { en: "Main Zone", ar: "المنطقة الرئيسية" }, parentId: null, depth: 1, levelName: null };
const tower: Location = { id: "22222222-2222-4222-8222-222222222222", code: "T1", name: { en: "Tower 1", ar: "البرج 1" }, parentId: zone.id, depth: 2, levelName: null };
const floor: Location = { id: "33333333-3333-4333-8333-333333333333", code: "F01", name: { en: "Tower 1 Floor 01", ar: "البرج 1 الطابق 01" }, parentId: tower.id, depth: 3, levelName: null };

describe("the Submittal Panel's place (RP-1065)", () => {
  it("is the item's Location path, top level first, for the Location section and the number card", () => {
    expect(submittalPanelPlace(floor, [zone, tower, floor], "en")).toEqual({
      shown: ["Main Zone", "Tower 1", "Tower 1 Floor 01"],
      numbered: ["Main Zone", "Tower 1", "Tower 1 Floor 01"],
    });
  });

  it("is the item's own place alone when the List doesn't hold its path, and then names no level on the number card", () => {
    // Otherwise a Zone or Building part would be explained with the item's own Floor's name.
    expect(submittalPanelPlace(floor, [], "ar")).toEqual({ shown: ["البرج 1 الطابق 01"], numbered: [] });
  });

  it("is empty for an item with no Location", () => {
    expect(submittalPanelPlace(null, [zone], "en")).toEqual({ shown: [], numbered: [] });
  });
});
