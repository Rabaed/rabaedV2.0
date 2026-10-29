import { SNAG_REPORT_OBJECTS } from "@rabaed/db";
import { iamPatternMatches } from "@rabaed/db/test-support/iam-pattern";
import { describe, expect, it } from "vitest";
import { snagReportKey } from "./job.ts";

// The infrastructure refuses the api any write under this pattern (RP-1084), so a Snag report the
// worker writes can't be overwritten or deleted through the api.
describe("a Snag report's file", () => {
  it("lives under its Project's snag-reports/ folder", () => {
    expect(snagReportKey("p1", "r1")).toBe("projects/p1/snag-reports/r1/snag-report.pdf");
  });

  it("is one the api may not overwrite or delete", () => {
    expect(iamPatternMatches(SNAG_REPORT_OBJECTS, snagReportKey("p1", "r1"))).toBe(true);
  });
});
