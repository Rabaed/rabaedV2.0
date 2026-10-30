import { describe, expect, it } from "vitest";
import { iamPatternMatches } from "../test-support/iam-pattern.ts";
import { DOCUMENT_OBJECTS, documentalRecordPrefix, RECORD_OBJECTS, REGISTER_IMPORT_OBJECTS, SNAG_REPORT_OBJECTS, snagReportPrefix } from "./storage-keys.ts";

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

// packages/db/test/storage-keys-sql.test.ts checks the SQL builders' keys fall inside these.
describe("the Project files keys the api stores (RP-1104)", () => {
  it("Documents and register imports are each under their Project, and apart from what only the worker writes", () => {
    expect(iamPatternMatches(DOCUMENT_OBJECTS, "projects/p1/work-items/w1/documents/d1")).toBe(true);
    expect(iamPatternMatches(REGISTER_IMPORT_OBJECTS, "projects/p1/register-imports/i1/f1")).toBe(true);
    for (const key of [`${documentalRecordPrefix("p1", "w1")}record.pdf`, `${snagReportPrefix("p1")}r1/snag-report.pdf`]) {
      expect(iamPatternMatches(DOCUMENT_OBJECTS, key)).toBe(false);
      expect(iamPatternMatches(REGISTER_IMPORT_OBJECTS, key)).toBe(false);
    }
  });
});
