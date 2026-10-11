import { workItemQuery } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { pagesByCursor } from "./query.ts";

// Home's everyRow reads every row by following `nextCursor`: only a query a cursor pages may be given to it (RP-409).
describe("which reads page by cursor to their end", () => {
  it("a cursor's own sort, in its own order, with no numbered page", () => {
    for (const sort of ["stepAge", "documentNumber", "submissionDate"] as const) expect(pagesByCursor(workItemQuery.parse({ sort }))).toBe(true);
  });

  it("never a List-only sort, a turned-round order or a numbered page: those are one page at a time", () => {
    expect(pagesByCursor(workItemQuery.parse({ sort: "owner" }))).toBe(false);
    expect(pagesByCursor(workItemQuery.parse({ sort: "stepAge", dir: "asc" }))).toBe(false);
    expect(pagesByCursor(workItemQuery.parse({ page: "1" }))).toBe(false);
  });
});
