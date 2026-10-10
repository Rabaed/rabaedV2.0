import { describe, expect, it } from "vitest";
import { listQueryFromSearchParams, listSearchParams } from "./list-url.ts";

describe("the List's URL (RP-409)", () => {
  it("opens at the first page of 25 rows, by Submittal No., as the owner's design does", () => {
    expect(listQueryFromSearchParams({})).toMatchObject({ sort: "documentNumber", page: 1, pageSize: 25 });
    expect(listSearchParams(listQueryFromSearchParams({})).toString()).toBe("");
  });

  it("keeps a page, its size and the order, and reads them back", () => {
    const query = listQueryFromSearchParams({ page: "3", pageSize: "10", sort: "owner", dir: "desc", stage: "draft" });
    expect(query).toMatchObject({ page: 3, pageSize: 10, sort: "owner", dir: "desc", stage: ["draft"] });
    expect(listQueryFromSearchParams(listSearchParams(query))).toEqual(query);
  });

  it("names the Step Age sort, which is the work item query's default, so it isn't read back as the List's", () => {
    const query = { ...listQueryFromSearchParams({}), sort: "stepAge" as const };
    expect(listSearchParams(query).get("sort")).toBe("stepAge");
    expect(listQueryFromSearchParams(listSearchParams(query)).sort).toBe("stepAge");
  });

  it("ignores an old link's cursor: the List pages by number", () => {
    expect(listQueryFromSearchParams({ cursor: "abc", page: "2" })).toMatchObject({ page: 2, cursor: undefined });
  });
});
