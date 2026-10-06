import { describe, expect, it } from "vitest";
import { enteredStepBy, stepAgeDots, stepAgeLabel, stepAgeWeeks } from "./step-age.ts";

const DAY = 86_400_000;
const entered = new Date("2026-09-01T10:00:00Z");
const after = (ms: number) => new Date(entered.getTime() + ms);

describe("enteredStepBy", () => {
  it("is the Step Age filter's bound: entered by it, the item is at least that many weeks in; a millisecond later, it isn't", () => {
    const now = after(30 * DAY);
    for (const weeks of [2, 3, 4]) {
      const bound = enteredStepBy(weeks, now);
      expect(stepAgeWeeks(bound, now)).toBe(weeks);
      expect(stepAgeWeeks(new Date(bound.getTime() + 1), now)).toBe(weeks - 1);
    }
  });
});

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

  it("treats part weeks as whole weeks and anything below 1 as the first week", () => {
    expect([2.9, 0, -3, Number.NaN].map(stepAgeDots)).toEqual([2, 1, 1, 1]);
  });
});

describe("stepAgeLabel", () => {
  it("says which week at the Step it is in English, counting from 1", () => {
    expect([1, 2, 4, 6].map((weeks) => stepAgeLabel(weeks, "en"))).toEqual([
      "1 week at this step",
      "2 weeks at this step",
      "4 weeks at this step",
      "6 weeks at this step",
    ]);
  });

  it("says which week at the Step it is in Arabic, with Latin digits and Arabic plural forms", () => {
    expect([1, 2, 3, 11, 100].map((weeks) => stepAgeLabel(weeks, "ar"))).toEqual([
      "أسبوع واحد في هذه الخطوة",
      "أسبوعان في هذه الخطوة",
      "3 أسابيع في هذه الخطوة",
      "11 أسبوعًا في هذه الخطوة",
      "100 أسبوع في هذه الخطوة",
    ]);
  });

  it("treats part weeks as whole weeks and anything below 1 as the first week", () => {
    expect([2.9, 0, -3, Number.NaN].map((weeks) => stepAgeLabel(weeks, "en"))).toEqual([
      "2 weeks at this step",
      "1 week at this step",
      "1 week at this step",
      "1 week at this step",
    ]);
  });
});
