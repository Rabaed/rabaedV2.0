import { describe, expect, it } from "vitest";
import {
  decodeWorkItemCursor,
  encodeWorkItemCursor,
  isFilteredWorkItemQuery,
  withoutFilters,
  workItemQuery,
  workItemQueryFromSearchParams,
  workItemSearchParams,
  type WorkItemQuery,
} from "./work-item-query.ts";

const trade = "0192e0a0-0000-7000-8000-000000000001";
const location = "0192e0a0-0000-7000-8000-000000000002";
const participant = "0192e0a0-0000-7000-8000-000000000003";
const row = "0192e0a0-0000-7000-8000-000000000004";

const defaults: WorkItemQuery = {
  type: [],
  stage: [],
  with: [],
  trade: [],
  location: [],
  outcome: [],
  bucket: [],
  codeC: [],
  stepAgeMin: undefined,
  allRevisions: false,
  sort: "stepAge",
  cursor: undefined,
};

describe("workItemQuery", () => {
  it("defaults to every visible chain's latest Revision, the oldest Step Age first", () => {
    expect(workItemQuery.parse({})).toEqual(defaults);
  });

  it("reads lists given joined by commas or repeated, once each", () => {
    expect(workItemQuery.parse({ stage: "submitted,under_review", type: ["MAR", "MAR"] })).toMatchObject({
      stage: ["submitted", "under_review"],
      type: ["MAR"],
    });
  });

  it("takes every With value, and nothing else", () => {
    const values = ["me", "unclaimed", "step:k1_review", `company:${participant}`];
    expect(workItemQuery.parse({ with: values.join(",") }).with).toEqual(values);
    for (const bad of ["someone", "step:", "company:not-an-id", "step:Bad Key"]) {
      expect(workItemQuery.safeParse({ with: bad }).success, bad).toBe(false);
    }
  });

  it("takes the Dashboard's buckets, and nothing else", () => {
    expect(workItemQuery.parse({ bucket: "A,B" }).bucket).toEqual(["A", "B"]);
    expect(workItemQuery.safeParse({ bucket: "late" }).success).toBe(false);
  });

  it("takes the Code C line's sub-states, and nothing else", () => {
    expect(workItemQuery.parse({ codeC: "approvedOnRevision,awaitingRevision" }).codeC).toEqual(["approvedOnRevision", "awaitingRevision"]);
    expect(workItemQuery.parse({ codeC: "noRevisionYet" }).codeC).toEqual(["noRevisionYet"]);
    expect(workItemQuery.safeParse({ codeC: "C" }).success).toBe(false);
  });

  it("takes a Step Age filter of 2, 3 or 4 weeks only", () => {
    expect(workItemQuery.parse({ stepAgeMin: "3" }).stepAgeMin).toBe(3);
    for (const bad of ["1", "5", "two"]) expect(workItemQuery.safeParse({ stepAgeMin: bad }).success, bad).toBe(false);
  });

  it("refuses a cursor made for the other sort, or that isn't one", () => {
    const cursor = encodeWorkItemCursor("stepAge", ["false", "2026-10-01T00:00:00.000000Z", row]);
    expect(workItemQuery.parse({ cursor }).cursor).toBe(cursor);
    expect(workItemQuery.safeParse({ cursor, sort: "documentNumber" }).success).toBe(false);
    expect(workItemQuery.safeParse({ cursor: "garbage" }).success).toBe(false);
  });
});

describe("the query in the URL", () => {
  const query: WorkItemQuery = {
    type: ["MAR"],
    stage: ["submitted", "under_review"],
    with: ["unclaimed", `company:${participant}`],
    trade: [trade],
    location: [location],
    outcome: ["C", "passed_with_comments"],
    bucket: ["pending", "in_preparation"],
    codeC: ["rejectedAfterC"],
    stepAgeMin: 2,
    allRevisions: true,
    sort: "documentNumber",
    cursor: encodeWorkItemCursor("documentNumber", ["false", "TWR-C1-EL-MAR-0001", row]),
  };

  it("reproduces the view: what a URL holds reads back the same", () => {
    const params = workItemSearchParams(query);
    expect(workItemQueryFromSearchParams(new URLSearchParams(params.toString()))).toEqual(query);
    expect(workItemQuery.parse(Object.fromEntries(params))).toEqual(query);
  });

  it("leaves the defaults out", () => {
    expect(workItemSearchParams(defaults).toString()).toBe("");
    expect(workItemSearchParams({ ...defaults, stage: ["draft"] }).toString()).toBe("stage=draft");
  });

  it("keeps a page's own filters when a parameter is bad, rather than failing", () => {
    expect(workItemQueryFromSearchParams({ stage: "draft", stepAgeMin: "9", with: "someone", sort: "nonsense" })).toEqual({
      ...defaults,
      stage: ["draft"],
    });
  });

  it("drops a cursor made for the other sort", () => {
    const cursor = encodeWorkItemCursor("stepAge", ["false", "2026-10-01T00:00:00.000000Z", row]);
    expect(workItemQueryFromSearchParams({ sort: "documentNumber", cursor }).cursor).toBeUndefined();
  });
});

describe("the cursor", () => {
  it("round-trips its sort key, Arabic text included", () => {
    const key = ["false", "رقم", row];
    expect(decodeWorkItemCursor(encodeWorkItemCursor("documentNumber", key), "documentNumber")).toEqual(key);
  });

  it("is refused when tampered with: every part must be what its sort puts there", () => {
    const at = "2026-10-01T00:00:00.000000Z";
    for (const [sort, key] of [
      ["stepAge", ["false", at, "not-an-id"]],
      ["stepAge", ["false", at]],
      ["stepAge", ["false", "yesterday", row]],
      ["stepAge", ["maybe", at, row]],
      ["stepAge", ["false", "2026-10-01T00:00:00Z", row]],
      ["documentNumber", ["0", "TWR-0001", row]],
      ["documentNumber", ["false", "TWR-0001", row, row]],
    ] as const) {
      expect(decodeWorkItemCursor(encodeWorkItemCursor(sort, key), sort), JSON.stringify(key)).toBeNull();
    }
  });
});

describe("filters", () => {
  it("are any of the narrowing keys, not the sort, Revisions or page", () => {
    expect(isFilteredWorkItemQuery(defaults)).toBe(false);
    expect(isFilteredWorkItemQuery({ ...defaults, sort: "documentNumber", allRevisions: true, cursor: "x" })).toBe(false);
    expect(isFilteredWorkItemQuery({ ...defaults, stepAgeMin: 2 })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, location: [location] })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, bucket: ["pending"] })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, codeC: ["awaitingRevision"] })).toBe(true);
  });

  it("clear to the first page, keeping the sort and Revisions", () => {
    const query: WorkItemQuery = { ...defaults, stage: ["draft"], stepAgeMin: 3, sort: "documentNumber", allRevisions: true, cursor: "x" };
    expect(withoutFilters(query)).toEqual({ ...defaults, sort: "documentNumber", allRevisions: true });
  });
});
