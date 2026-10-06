import { describe, expect, it } from "vitest";
import { dueRun, weeklyStepAgeReportSchedule } from "./schedule.ts";
import { stepAgeReportGroups, stepAgeReportQuery } from "./step-age-report.ts";
import { workItemQuery, workItemSearchParams, workItemQueryFromSearchParams } from "./work-item-query.ts";

// 2026-10-04 is a Sunday; Riyadh is UTC+3 all year.
const SUNDAY_7_RIYADH = new Date("2026-10-04T04:00:00Z");
const due = (at: string) => dueRun(weeklyStepAgeReportSchedule, new Date(at));

describe("the weekly report's schedule: Sunday 07:00 Riyadh", () => {
  it("is due from Sunday 07:00 Riyadh time, and still later that Sunday", () => {
    for (const at of ["2026-10-04T04:00:00Z", "2026-10-04T09:30:00Z", "2026-10-04T15:59:59Z"]) {
      expect(due(at)).toEqual(SUNDAY_7_RIYADH);
    }
  });

  it("is not due before 07:00 on Sunday in Riyadh", () => {
    expect(due("2026-10-04T03:59:59Z")).toBeNull();
    // Saturday 23:30 in Riyadh.
    expect(due("2026-10-03T20:30:00Z")).toBeNull();
  });

  it("is never due Monday to Saturday: a missed Sunday is not made up later in the week", () => {
    for (let day = 5; day <= 10; day++) {
      for (const hourUtc of ["04", "09"]) {
        expect(due(`2026-10-${String(day).padStart(2, "0")}T${hourUtc}:00:00Z`)).toBeNull();
      }
    }
  });

  it("is the next Sunday's 07:00 a week later", () => {
    expect(due("2026-10-11T05:00:00Z")).toEqual(new Date("2026-10-11T04:00:00Z"));
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

  it("is the List of the open Stages with a Step Age, sorted by it: no un-numbered Draft, as in the report (scenario 76)", () => {
    expect(stepAgeReportQuery(open)).toEqual(workItemQuery.parse({ stage: open, stepAgeMin: 1 }));
  });

  it("narrows to a Step Age when given one", () => {
    expect(stepAgeReportQuery(open, 4)).toEqual(workItemQuery.parse({ stage: open, stepAgeMin: 4 }));
  });

  it("goes through the URL unchanged", () => {
    const query = stepAgeReportQuery(open, 4);
    expect(workItemQueryFromSearchParams(workItemSearchParams(query))).toEqual(query);
  });
});
