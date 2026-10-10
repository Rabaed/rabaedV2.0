import { describe, expect, it } from "vitest";
import {
  decodeWorkItemCursor,
  encodeWorkItemCursor,
  isFilteredWorkItemQuery,
  withoutFilters,
  workItemQuery,
  workItemQueryFromSearchParams,
  workItemListHref,
  workItemSearchParams,
  type WorkItemQuery,
} from "./work-item-query.ts";

const trade = "0192e0a0-0000-7000-8000-000000000001";
const location = "0192e0a0-0000-7000-8000-000000000002";
const participant = "0192e0a0-0000-7000-8000-000000000003";
const row = "0192e0a0-0000-7000-8000-000000000004";

const defaults: WorkItemQuery = {
  module: "submittals",
  type: [],
  stage: [],
  with: [],
  trade: [],
  location: [],
  outcome: [],
  bucket: [],
  codeC: [],
  stepAgeMin: undefined,
  q: undefined,
  needMyAction: false,
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
    const values = ["me", "not_picked_up", "step:k1_review", `company:${participant}`];
    expect(workItemQuery.parse({ with: values.join(",") }).with).toEqual(values);
    for (const bad of ["someone", "step:", "company:not-an-id", "step:Bad Key"]) {
      expect(workItemQuery.safeParse({ with: bad }).success, bad).toBe(false);
    }
  });

  it("takes the Dashboard's buckets, an outcome a Project Admin added among them, and nothing else", () => {
    expect(workItemQuery.parse({ bucket: "A,B,E,pending" }).bucket).toEqual(["A", "B", "E", "pending"]);
    for (const bad of ["1A", "late-1", "A B"]) expect(workItemQuery.safeParse({ bucket: bad }).success, bad).toBe(false);
  });

  it("takes the Code C line's sub-states, and nothing else", () => {
    expect(workItemQuery.parse({ codeC: "approvedOnRevision,awaitingRevision" }).codeC).toEqual(["approvedOnRevision", "awaitingRevision"]);
    expect(workItemQuery.parse({ codeC: "noRevisionYet" }).codeC).toEqual(["noRevisionYet"]);
    expect(workItemQuery.safeParse({ codeC: "C" }).success).toBe(false);
  });

  it("reads one Module, the Submittals by default, and nothing else", () => {
    expect(workItemQuery.parse({ module: "snag_list" }).module).toBe("snag_list");
    expect(workItemQuery.safeParse({ module: "tendering" }).success).toBe(false);
  });

  it("takes a Step Age filter of 1, 2, 3 or 4 weeks only", () => {
    expect(workItemQuery.parse({ stepAgeMin: "3" }).stepAgeMin).toBe(3);
    // 1: any Step Age at all, so never an un-numbered Draft (scenario 76).
    expect(workItemQuery.parse({ stepAgeMin: "1" }).stepAgeMin).toBe(1);
    for (const bad of ["0", "5", "two"]) expect(workItemQuery.safeParse({ stepAgeMin: bad }).success, bad).toBe(false);
  });

  it("refuses a cursor made for the other sort, or that isn't one", () => {
    const cursor = encodeWorkItemCursor("stepAge", ["false", "2026-10-01T00:00:00.000000Z", "", row]);
    expect(workItemQuery.parse({ cursor }).cursor).toBe(cursor);
    expect(workItemQuery.safeParse({ cursor, sort: "documentNumber" }).success).toBe(false);
    expect(workItemQuery.safeParse({ cursor: "garbage" }).success).toBe(false);
  });
});

describe("the query in the URL", () => {
  const query: WorkItemQuery = {
    module: "inspections",
    type: ["MAR"],
    stage: ["submitted", "under_review"],
    with: ["not_picked_up", `company:${participant}`],
    trade: [trade],
    location: [location],
    outcome: ["C", "passed_with_comments"],
    bucket: ["pending", "in_preparation"],
    codeC: ["rejectedAfterC"],
    stepAgeMin: 2,
    needMyAction: true,
    allRevisions: true,
    sort: "documentNumber",
    cursor: encodeWorkItemCursor("documentNumber", ["false", "TWR-C1-EL-MAR-0001", "", row]),
  };

  it("reproduces the view: what a URL holds reads back the same", () => {
    const params = workItemSearchParams(query);
    expect(workItemQueryFromSearchParams(new URLSearchParams(params.toString()))).toEqual(query);
    expect(workItemQuery.parse(Object.fromEntries(params))).toEqual(query);
  });

  it("leaves the defaults out", () => {
    expect(workItemSearchParams(defaults).toString()).toBe("");
    expect(workItemSearchParams({ ...defaults, stage: ["draft"] }).toString()).toBe("stage=draft");
    expect(workItemSearchParams({ ...defaults, module: "snag_list" }).toString()).toBe("module=snag_list");
  });

  it("keeps a page's own filters when a parameter is bad, rather than failing", () => {
    expect(workItemQueryFromSearchParams({ stage: "draft", stepAgeMin: "9", with: "someone", sort: "nonsense" })).toEqual({
      ...defaults,
      stage: ["draft"],
    });
  });

  it("keeps Need My Action as needMyAction=true, and reads it back", () => {
    expect(workItemSearchParams({ ...defaults, needMyAction: true }).toString()).toBe("needMyAction=true");
    expect(workItemQueryFromSearchParams({ needMyAction: "true" }).needMyAction).toBe(true);
    expect(workItemQueryFromSearchParams({ needMyAction: "nonsense" }).needMyAction).toBe(false);
  });

  it("drops a cursor made for the other sort", () => {
    const cursor = encodeWorkItemCursor("stepAge", ["false", "2026-10-01T00:00:00.000000Z", "", row]);
    expect(workItemQueryFromSearchParams({ sort: "documentNumber", cursor }).cursor).toBeUndefined();
  });
});

describe("the cursor", () => {
  it("round-trips its sort key, Arabic text included", () => {
    for (const key of [["false", "رقم", "", row], ["true", "", "كابلات", row]]) {
      expect(decodeWorkItemCursor(encodeWorkItemCursor("documentNumber", key), "documentNumber")).toEqual(key);
    }
  });

  it("is refused when tampered with: every part must be what its sort puts there", () => {
    const at = "2026-10-01T00:00:00.000000Z";
    for (const [sort, key] of [
      ["stepAge", ["false", at, "", "not-an-id"]],
      ["stepAge", ["false", at, row]],
      ["stepAge", ["false", "yesterday", "", row]],
      ["stepAge", ["maybe", at, "", row]],
      ["stepAge", ["false", "2026-10-01T00:00:00Z", "", row]],
      // A Subject only for an item with no Step Age.
      ["stepAge", ["false", at, "Cables", row]],
      ["documentNumber", ["0", "TWR-0001", "", row]],
      ["documentNumber", ["false", "TWR-0001", "", row, row]],
      ["documentNumber", ["false", "TWR-0001", row]],
      // A Subject only for an item with no number, and then no number.
      ["documentNumber", ["false", "TWR-0001", "Cables", row]],
      ["documentNumber", ["true", "TWR-0001", "Cables", row]],
      ["documentNumber", ["false", "", "", row]],
      ["submissionDate", ["false", at, row]],
      ["submissionDate", ["false", at, "Cables", row]],
      // Not yet Submitted: no time, whatever the Subject.
      ["submissionDate", ["true", at, "Cables", row]],
      ["submissionDate", ["true", "yesterday", "", row]],
    ] as const) {
      expect(decodeWorkItemCursor(encodeWorkItemCursor(sort, key), sort), JSON.stringify(key)).toBeNull();
    }
  });
});

describe("filters", () => {
  it("are any of the narrowing keys, not the sort, Revisions or page", () => {
    expect(isFilteredWorkItemQuery(defaults)).toBe(false);
    expect(isFilteredWorkItemQuery({ ...defaults, sort: "documentNumber", allRevisions: true, cursor: "x" })).toBe(false);
    expect(isFilteredWorkItemQuery({ ...defaults, module: "snag_list" })).toBe(false);
    expect(isFilteredWorkItemQuery({ ...defaults, stepAgeMin: 2 })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, location: [location] })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, needMyAction: true })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, bucket: ["pending"] })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, codeC: ["awaitingRevision"] })).toBe(true);
  });

  it("clear to the first page, keeping the Module, the sort and Revisions", () => {
    const query: WorkItemQuery = { ...defaults, module: "snag_list", stage: ["draft"], stepAgeMin: 3, needMyAction: true, sort: "documentNumber", allRevisions: true, cursor: "x" };
    expect(withoutFilters(query)).toEqual({ ...defaults, module: "snag_list", sort: "documentNumber", allRevisions: true });
  });
});

describe("the Submission Date range and sort (RP-348)", () => {
  const rangeQuery: WorkItemQuery = { ...defaults, submittedFrom: "2026-03-01", submittedTo: "2026-03-31", sort: "submissionDate" };

  it("takes days, refusing one that does not exist", () => {
    expect(workItemQuery.parse({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" })).toMatchObject({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" });
    for (const bad of ["2026-02-30", "2026-3-1", "yesterday", "2026-03-01T00:00:00Z"]) {
      expect(workItemQuery.safeParse({ submittedFrom: bad }).success, bad).toBe(false);
    }
  });

  it("reproduces the view from the URL, and leaves an unset range out", () => {
    const params = workItemSearchParams(rangeQuery);
    expect(params.toString()).toBe("submittedFrom=2026-03-01&submittedTo=2026-03-31&sort=submissionDate");
    expect(workItemQueryFromSearchParams(new URLSearchParams(params.toString()))).toEqual(rangeQuery);
    expect(workItemQueryFromSearchParams({ submittedFrom: "not-a-day", stage: "draft" })).toEqual({ ...defaults, stage: ["draft"] });
  });

  it("counts the range as a filter, which clearing removes, keeping the sort", () => {
    expect(isFilteredWorkItemQuery({ ...defaults, submittedTo: "2026-03-31" })).toBe(true);
    expect(isFilteredWorkItemQuery({ ...defaults, sort: "submissionDate" })).toBe(false);
    expect(withoutFilters(rangeQuery)).toEqual({ ...defaults, sort: "submissionDate" });
  });

  it("has a Step Age cursor with no time for an item with no Step Age (a Draft with no number), but its Subject", () => {
    const key = ["false", "", "كابلات", row];
    expect(decodeWorkItemCursor(encodeWorkItemCursor("stepAge", key), "stepAge")).toEqual(key);
  });

  it("has a cursor holding the last row's Submission Date, or its Subject when it has none", () => {
    const at = "2026-03-01T09:00:00.123456Z";
    for (const key of [["false", at, "", row], ["true", "", "Cables", row], ["true", "", "", row]]) {
      expect(decodeWorkItemCursor(encodeWorkItemCursor("submissionDate", key), "submissionDate")).toEqual(key);
    }
    for (const key of [["false", "", "", row], ["false", "", "Cables", row], ["false", "yesterday", "", row], ["maybe", at, "", row], ["false", at, "", "not-an-id"]]) {
      expect(decodeWorkItemCursor(encodeWorkItemCursor("submissionDate", key), "submissionDate"), JSON.stringify(key)).toBeNull();
    }
  });
});

describe("search (q)", () => {
  it("is the words given, trimmed; nothing but spaces is no search", () => {
    expect(workItemQuery.parse({ q: "  MAR-00 " }).q).toBe("MAR-00");
    expect(workItemQuery.parse({ q: "   " }).q).toBeUndefined();
    expect(workItemQuery.parse({ q: "" }).q).toBeUndefined();
    expect(workItemQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });

  it("is kept in the URL, Arabic included, and read back the same", () => {
    const query: WorkItemQuery = { ...defaults, q: "إنارة LED" };
    const params = workItemSearchParams(query);
    expect(params.get("q")).toBe("إنارة LED");
    expect(workItemQueryFromSearchParams(new URLSearchParams(params.toString()))).toEqual(query);
    expect(workItemSearchParams({ ...defaults, q: undefined }).toString()).toBe("");
  });

  it("narrows the rows, so clearing the filters clears it", () => {
    expect(isFilteredWorkItemQuery({ ...defaults, q: "lighting" })).toBe(true);
    expect(withoutFilters({ ...defaults, q: "lighting" }).q).toBeUndefined();
  });
});

describe("the List's web path", () => {
  const project = "0192e0a0-0000-7000-8000-0000000000aa";

  it("is the Module's tab, which names the Module, with the other parameters", () => {
    expect(workItemListHref(project, { module: "snag_list", type: ["SNAG"], bucket: ["pending"] })).toBe(`/projects/${project}/snag-list?type=SNAG&bucket=pending`);
    expect(workItemListHref(project, { ...defaults })).toBe(`/projects/${project}/work-items`);
    expect(workItemListHref(project, { module: "submittals", codeC: ["awaitingRevision"] })).toBe(`/projects/${project}/work-items?codeC=awaitingRevision`);
  });
});
