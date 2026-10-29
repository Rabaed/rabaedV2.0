import { describe, expect, it } from "vitest";
import { documentalRecordPrefix, RECORD_OBJECTS, SNAG_REPORT_OBJECTS, snagReportPrefix } from "./storage-keys.ts";

// An IAM key pattern, as S3 matches it: `*` is any run of characters, `/` included.
const matches = (pattern: string, key: string) => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(key);

describe("the Project files keys only the worker writes (RP-1084)", () => {
  it("an item's Documental Record folder is under its Project and item", () => {
    expect(documentalRecordPrefix("p1", "w1")).toBe("projects/p1/work-items/w1/documental-record/");
  });

  it("a Project's Snag reports folder is under its Project", () => {
    expect(snagReportPrefix("p1")).toBe("projects/p1/snag-reports/");
  });

  it("the infrastructure's patterns cover every file under those folders, in any Project", () => {
    expect(matches(RECORD_OBJECTS, `${documentalRecordPrefix("p1", "w1")}record.pdf`)).toBe(true);
    expect(matches(RECORD_OBJECTS, `${documentalRecordPrefix("p2", "w2")}working-copies/c1.pdf`)).toBe(true);
    expect(matches(SNAG_REPORT_OBJECTS, `${snagReportPrefix("p1")}r1/snag-report.pdf`)).toBe(true);
  });

  it("and nothing the api stores itself, such as a Document", () => {
    expect(matches(RECORD_OBJECTS, "projects/p1/work-items/w1/documents/d1")).toBe(false);
    expect(matches(SNAG_REPORT_OBJECTS, "projects/p1/work-items/w1/documents/d1")).toBe(false);
  });
});
