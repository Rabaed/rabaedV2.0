import { describe, expect, it } from "vitest";
import { byNewestWaiting, homeGreeting, mergeActivity } from "./home.ts";

const item = (id: string, title: string, stepEnteredAt: string | null) => ({ id, title, stepEnteredAt });

describe("byNewestWaiting", () => {
  it("puts the item that reached its Step last first, and one with no Step Age last, by Subject", () => {
    const rows = [
      item("1", "Old", "2026-09-01T08:00:00.000Z"),
      item("2", "Zebra, no number", null),
      item("3", "New", "2026-10-01T08:00:00.000Z"),
      item("4", "Apple, no number", null),
      item("5", "Middle", "2026-09-15T08:00:00.000Z"),
    ];
    expect(rows.toSorted(byNewestWaiting).map((r) => r.title)).toEqual(["New", "Middle", "Old", "Apple, no number", "Zebra, no number"]);
  });

  it("breaks a tie by Subject, then id", () => {
    const at = "2026-09-01T08:00:00.000Z";
    const rows = [item("b", "Same", at), item("a", "Same", at), item("c", "Earlier letter", at)];
    expect(rows.toSorted(byNewestWaiting).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("homeGreeting", () => {
  it("follows the time in Riyadh, not UTC", () => {
    // 05:30 UTC is 08:30 in Riyadh.
    expect(homeGreeting(new Date("2026-10-09T05:30:00Z"))).toBe("morning");
    expect(homeGreeting(new Date("2026-10-09T08:59:00Z"))).toBe("morning");
    expect(homeGreeting(new Date("2026-10-09T09:00:00Z"))).toBe("afternoon");
    expect(homeGreeting(new Date("2026-10-09T15:00:00Z"))).toBe("evening");
    // 22:30 UTC is 01:30 the next day in Riyadh.
    expect(homeGreeting(new Date("2026-10-09T22:30:00Z"))).toBe("evening");
    expect(homeGreeting(new Date("2026-10-10T01:00:00Z"))).toBe("morning");
  });
});

describe("mergeActivity", () => {
  const entry = (id: string, at: string) => ({ id, at });

  it("merges several Projects' feeds newest first and keeps only the newest `limit`", () => {
    const twr = [entry("t3", "2026-10-03T00:00:00.000Z"), entry("t1", "2026-10-01T00:00:00.000Z")];
    const jcv = [entry("j4", "2026-10-04T00:00:00.000Z"), entry("j2", "2026-10-02T00:00:00.000Z"), entry("j0", "2026-09-30T00:00:00.000Z")];
    expect(mergeActivity([twr, jcv], 3).map((e) => e.id)).toEqual(["j4", "t3", "j2"]);
  });

  it("is empty with no Projects", () => {
    expect(mergeActivity([], 8)).toEqual([]);
  });
});
