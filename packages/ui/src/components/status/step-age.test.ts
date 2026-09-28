import { describe, expect, it } from "vitest";
import { ageDotCount, stepAgeLabel } from "./step-age.ts";

describe("ageDotCount", () => {
  it("shows one dot per whole week, up to 4", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(ageDotCount)).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });

  it("treats part weeks and bad input as whole weeks, never below 0", () => {
    expect([1.9, -1, Number.NaN].map(ageDotCount)).toEqual([1, 0, 0]);
  });
});

describe("stepAgeLabel", () => {
  it("says how many weeks in English", () => {
    expect([0, 1, 2, 4, 6].map((weeks) => stepAgeLabel(weeks, "en"))).toEqual([
      "0 weeks at this step",
      "1 week at this step",
      "2 weeks at this step",
      "4 weeks at this step",
      "6 weeks at this step",
    ]);
  });

  it("says how many weeks in Arabic, with Latin digits and Arabic plural forms", () => {
    expect([0, 1, 2, 3, 11, 100].map((weeks) => stepAgeLabel(weeks, "ar"))).toEqual([
      "0 أسبوع في هذه الخطوة",
      "أسبوع واحد في هذه الخطوة",
      "أسبوعان في هذه الخطوة",
      "3 أسابيع في هذه الخطوة",
      "11 أسبوعًا في هذه الخطوة",
      "100 أسبوع في هذه الخطوة",
    ]);
  });
});
