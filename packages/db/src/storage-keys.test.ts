import { describe, expect, it } from "vitest";
import { iamPatternMatches } from "../test-support/iam-pattern.ts";
import { documentalRecordPrefix, RECORD_OBJECTS, SNAG_REPORT_OBJECTS, snagReportPrefix } from "./storage-keys.ts";

// The worker's own tests check that every key it writes falls inside these patterns (apps/worker record/files.test.ts).
describe("the Project files keys only the worker writes (RP-1084)", () => {
  it("an item's Documental Record folder is under its Project and item", () => {
    expect(documentalRecordPrefix("p1", "w1")).toBe("projects/p1/work-items/w1/documental-record/");
  });

  it("a Project's Snag reports folder is under its Project", () => {
    expect(snagReportPrefix("p1")).toBe("projects/p1/snag-reports/");
  });

  it("the patterns leave out what the api stores itself, such as a Document", () => {
    expect(iamPatternMatches(RECORD_OBJECTS, "projects/p1/work-items/w1/documents/d1")).toBe(false);
    expect(iamPatternMatches(SNAG_REPORT_OBJECTS, "projects/p1/work-items/w1/documents/d1")).toBe(false);
  });
});
