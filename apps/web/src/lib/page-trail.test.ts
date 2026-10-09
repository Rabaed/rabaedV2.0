import { encodeWorkItemCursor, workItemQuery, workItemQueryFromSearchParams } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { pageTrailFromSearchParams, workItemListSearchParams } from "./page-trail.ts";

const cursor = (n: number) => encodeWorkItemCursor("documentNumber", ["false", `TWR-MAR-000${n}`, "", `00000000-0000-4000-8000-00000000000${n}`]);
const sorted = workItemQuery.parse({ sort: "documentNumber" });

/** The query and trail a page reads back from the URL a link gave it. */
function roundTrip(params: URLSearchParams) {
  const query = workItemQueryFromSearchParams(params);
  return { query, trail: pageTrailFromSearchParams(params, query) };
}

describe("the List's page trail in the URL", () => {
  it("leaves the first page's URL as it was", () => {
    expect(workItemListSearchParams(sorted, []).toString()).toBe("sort=documentNumber");
  });

  it("brings the second page back with an empty trail, so it is page 2 and Previous goes to the first", () => {
    const back = roundTrip(workItemListSearchParams({ ...sorted, cursor: cursor(1) }, []));
    expect(back.query.cursor).toBe(cursor(1));
    expect(back.trail).toEqual([]);
  });

  it("brings a later page back with the cursors of the pages before it, oldest first", () => {
    const back = roundTrip(workItemListSearchParams({ ...sorted, cursor: cursor(3) }, [cursor(1), cursor(2)]));
    expect(back.trail).toEqual([cursor(1), cursor(2)]);
  });

  it("knows no trail for a later page linked from elsewhere (no page number)", () => {
    const params = new URLSearchParams({ sort: "documentNumber", cursor: cursor(2) });
    expect(roundTrip(params).trail).toBeUndefined();
  });

  it("drops a trail that doesn't add up or holds a cursor of another sort", () => {
    const short = workItemListSearchParams({ ...sorted, cursor: cursor(3) }, [cursor(1), cursor(2)]);
    short.set("page", "5");
    expect(roundTrip(short).trail).toBeUndefined();
    const otherSort = workItemListSearchParams({ ...sorted, cursor: cursor(2) }, [encodeWorkItemCursor("stepAge", ["false", "", "Cable", "00000000-0000-4000-8000-000000000001"])]);
    expect(roundTrip(otherSort).trail).toBeUndefined();
  });

  it("keeps no trail on the first page", () => {
    expect(workItemListSearchParams(sorted, [cursor(1)]).has("before")).toBe(false);
  });
});
