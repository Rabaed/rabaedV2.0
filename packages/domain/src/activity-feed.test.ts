import { describe, expect, it } from "vitest";
import { activityFeedPageSize, activityFeedQuery, activityFeedSearchParams, decodeActivityCursor, encodeActivityCursor } from "./activity-feed.ts";

const event = "0192e0a0-0000-7000-8000-000000000004";

describe("activityFeedQuery", () => {
  it("defaults to the whole Project, newest first, a page of 30", () => {
    expect(activityFeedQuery.parse({})).toEqual({ module: undefined, type: [], mine: false, cursor: undefined, limit: activityFeedPageSize });
    expect(activityFeedPageSize).toBe(30);
  });

  it("takes a Module, Types joined by commas or repeated, and \"items I'm on\"", () => {
    expect(activityFeedQuery.parse({ module: "submittals", type: ["MAR,SAR", "MAR"], mine: "true" })).toMatchObject({
      module: "submittals",
      type: ["MAR", "SAR"],
      mine: true,
    });
  });

  it("refuses a Module or Type that isn't one, and a page size out of range", () => {
    for (const bad of [{ module: "schedule" }, { type: "not a code" }, { limit: "0" }, { limit: "101" }, { limit: "ten" }]) {
      expect(activityFeedQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("takes a cursor it made, and refuses one that was tampered with", () => {
    const cursor = encodeActivityCursor(event);
    expect(activityFeedQuery.parse({ cursor }).cursor).toBe(cursor);
    const tampered = [
      "garbage",
      btoa(JSON.stringify(["activity", "not-an-id"])),
      btoa(JSON.stringify(["activity", event, "extra"])),
      btoa(JSON.stringify(["stepAge", event])),
      btoa(JSON.stringify(["activity", 7])),
      btoa(JSON.stringify({ activity: event })),
    ];
    for (const bad of tampered) expect(activityFeedQuery.safeParse({ cursor: bad }).success, bad).toBe(false);
  });
});

describe("the cursor", () => {
  it("holds the last entry's event id, and nothing else", () => {
    expect(decodeActivityCursor(encodeActivityCursor(event))).toEqual({ id: event });
    expect(decodeActivityCursor("garbage")).toBeNull();
  });
});

describe("activityFeedSearchParams", () => {
  it("leaves defaults out, in a stable order", () => {
    expect(activityFeedSearchParams({}).toString()).toBe("");
    expect(activityFeedSearchParams({ module: "submittals", type: ["MAR", "SAR"], mine: true, limit: 30 }).toString()).toBe(
      "module=submittals&type=MAR%2CSAR&mine=true",
    );
    expect(activityFeedSearchParams({ cursor: "abc", limit: 10 }).toString()).toBe("cursor=abc&limit=10");
  });
});
