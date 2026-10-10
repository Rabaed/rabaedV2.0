import { describe, expect, it } from "vitest";
import { busiestProjectId, byNewestWaiting, homeGreeting, isWaitingWithOthers, mergeActivity, relativeAge } from "./home.ts";

describe("relativeAge", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const minute = 60_000;
  const hour = 60 * minute;

  it("is 'now' under a minute, and for a time a skewed clock puts ahead", () => {
    expect(relativeAge(ago(59_000), now)).toEqual({ unit: "now" });
    expect(relativeAge(new Date(now.getTime() + 5_000).toISOString(), now)).toEqual({ unit: "now" });
  });

  it("counts whole minutes under an hour, then whole hours under a day", () => {
    expect(relativeAge(ago(minute), now)).toEqual({ unit: "minutes", count: 1 });
    expect(relativeAge(ago(10 * minute + 59_000), now)).toEqual({ unit: "minutes", count: 10 });
    expect(relativeAge(ago(hour), now)).toEqual({ unit: "hours", count: 1 });
    expect(relativeAge(ago(3 * hour + 59 * minute), now)).toEqual({ unit: "hours", count: 3 });
    expect(relativeAge(ago(24 * hour - 1), now)).toEqual({ unit: "hours", count: 23 });
  });

  it("gives the date from a day on", () => {
    expect(relativeAge(ago(24 * hour), now)).toEqual({ unit: "date" });
    expect(relativeAge(ago(40 * 24 * hour), now)).toEqual({ unit: "date" });
  });
});

describe("isWaitingWithOthers", () => {
  const own = { kind: "own" as const, companyName: { en: "C1", ar: "C1" }, step: { key: "s", name: { en: "S", ar: "S" } }, claimer: null };
  const other = { kind: "company" as const, companyName: { en: "K1", ar: "K1" } };
  const created = "2026-09-01T08:00:00.000Z";

  it("is an item my own Participant raised (its Creation Date is mine to read) that another Company holds", () => {
    expect(isWaitingWithOthers({ with: other, creationDate: created })).toBe(true);
  });

  it("is never an item we hold, a closed one, or another Company's item", () => {
    expect(isWaitingWithOthers({ with: own, creationDate: created })).toBe(false);
    expect(isWaitingWithOthers({ with: null, creationDate: created })).toBe(false);
    // Another Company raised it: I never read its Creation Date (visibility.md "Creation Date").
    expect(isWaitingWithOthers({ with: other, creationDate: null })).toBe(false);
  });
});

describe("busiestProjectId", () => {
  it("is the Project with the most, the first listed on a tie, none when all are zero", () => {
    expect(busiestProjectId([["a", 1], ["b", 3], ["c", 3]])).toBe("b");
    expect(busiestProjectId([["a", 0], ["b", 0]])).toBeUndefined();
    expect(busiestProjectId([])).toBeUndefined();
  });
});

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
