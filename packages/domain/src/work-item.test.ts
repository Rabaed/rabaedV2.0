import { describe, expect, it } from "vitest";
import { createWorkItemRequest, stepAgeDots, stepAgeWeeks } from "./work-item.ts";

const DAY = 86_400_000;
const entered = new Date("2026-09-01T10:00:00Z");
const after = (ms: number) => new Date(entered.getTime() + ms);

describe("stepAgeWeeks", () => {
  it("is 1 in the first week at the Step, 2 in the second, and so on", () => {
    expect(stepAgeWeeks(entered, entered)).toBe(1);
    expect(stepAgeWeeks(entered, after(7 * DAY - 1))).toBe(1);
    expect(stepAgeWeeks(entered, after(7 * DAY))).toBe(2);
    expect(stepAgeWeeks(entered, after(40 * DAY))).toBe(6);
  });

  it("never goes below 1, even if the clocks disagree", () => {
    expect(stepAgeWeeks(entered, after(-DAY))).toBe(1);
  });
});

describe("stepAgeDots", () => {
  it("shows one dot per week, up to 4", () => {
    expect([1, 2, 3, 4, 5, 12].map(stepAgeDots)).toEqual([1, 2, 3, 4, 4, 4]);
  });
});

describe("createWorkItemRequest", () => {
  const trade = "0192e0a0-0000-7000-8000-000000000001";

  it("trims the title and makes Location and description optional", () => {
    expect(createWorkItemRequest.parse({ type: "MAR", title: "  Cable trays ", tradeId: trade })).toEqual({
      type: "MAR",
      title: "Cable trays",
      tradeId: trade,
      locationId: null,
      description: "",
    });
  });

  it("needs a title and a Trade", () => {
    expect(createWorkItemRequest.safeParse({ type: "MAR", title: " ", tradeId: trade }).success).toBe(false);
    expect(createWorkItemRequest.safeParse({ type: "MAR", title: "Cable trays" }).success).toBe(false);
  });
});
