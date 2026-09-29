import { describe, expect, it } from "vitest";
import { stepAgeLabel } from "./step-age.ts";

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
