import { describe, expect, it } from "vitest";
import { stepAgeReportDueAt, stepAgeReportGroups, stepAgeReportQuery } from "./step-age-report.ts";
import { workItemQuery, workItemSearchParams, workItemQueryFromSearchParams } from "./work-item-query.ts";

// 2026-10-04 is a Sunday; Riyadh is UTC+3 all year.
const SUNDAY_7_RIYADH = new Date("2026-10-04T04:00:00Z");

describe("stepAgeReportDueAt", () => {
  it("is Sunday 07:00 Riyadh time from that moment until the end of Sunday in Riyadh", () => {
    for (const at of ["2026-10-04T04:00:00Z", "2026-10-04T09:30:00Z", "2026-10-04T20:59:59Z"]) {
      expect(stepAgeReportDueAt(new Date(at))).toEqual(SUNDAY_7_RIYADH);
    }
  });

  it("is not due before 07:00 on Sunday in Riyadh", () => {
    expect(stepAgeReportDueAt(new Date("2026-10-04T03:59:59Z"))).toBeNull();
    // Saturday 23:30 in Riyadh, already Sunday nowhere near.
    expect(stepAgeReportDueAt(new Date("2026-10-03T20:30:00Z"))).toBeNull();
  });

  it("is not due on any other day of the week, at any hour", () => {
    // Monday 00:00 Riyadh, and every day Monday to Saturday at 07:00 and 12:00 Riyadh.
    expect(stepAgeReportDueAt(new Date("2026-10-04T21:00:00Z"))).toBeNull();
    for (let day = 5; day <= 10; day++) {
      for (const hourUtc of ["04", "09"]) {
        expect(stepAgeReportDueAt(new Date(`2026-10-${String(day).padStart(2, "0")}T${hourUtc}:00:00Z`))).toBeNull();
      }
    }
  });

  it("is the next Sunday's 07:00 a week later", () => {
    expect(stepAgeReportDueAt(new Date("2026-10-11T05:00:00Z"))).toEqual(new Date("2026-10-11T04:00:00Z"));
  });
});

describe("stepAgeReportGroups", () => {
  const item = (id: string, stepAgeWeeks: number) => ({ id, stepAgeWeeks });

  it("groups items by Step Age, 4+ weeks first, then 3, 2 and 1, keeping their order inside a group", () => {
    const groups = stepAgeReportGroups([item("a", 9), item("b", 4), item("c", 3), item("d", 1), item("e", 3), item("f", 2)]);
    expect(groups).toEqual([
      { weeks: 4, items: [item("a", 9), item("b", 4)] },
      { weeks: 3, items: [item("c", 3), item("e", 3)] },
      { weeks: 2, items: [item("f", 2)] },
      { weeks: 1, items: [item("d", 1)] },
    ]);
  });

  it("leaves out an empty group", () => {
    expect(stepAgeReportGroups([item("a", 2)])).toEqual([{ weeks: 2, items: [item("a", 2)] }]);
    expect(stepAgeReportGroups([])).toEqual([]);
  });
});

describe("stepAgeReportQuery", () => {
  const open = ["draft", "internal_review", "pending_approval"];

  it("is the List of the open Stages, sorted by Step Age", () => {
    expect(stepAgeReportQuery(open)).toEqual(workItemQuery.parse({ stage: open }));
  });

  it("narrows to a Step Age when given one", () => {
    expect(stepAgeReportQuery(open, 4)).toEqual(workItemQuery.parse({ stage: open, stepAgeMin: 4 }));
  });

  it("goes through the URL unchanged", () => {
    const query = stepAgeReportQuery(open, 4);
    expect(workItemQueryFromSearchParams(workItemSearchParams(query))).toEqual(query);
  });
});
