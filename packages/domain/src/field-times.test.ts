import { describe, expect, it } from "vitest";
import { changedByLabel, mergeFieldAnswers, savedLabel, type FieldStamps } from "./field-times.ts";

const me = "member-me";
const other = "member-other";
const omar = { en: "Omar", ar: "عمر" };
const stamp = (at: string, by: string | null = other, name: { en: string; ar: string } | null = omar) => ({ at, by, name });

describe("mergeFieldAnswers", () => {
  it("takes every submitted field when nobody else changed anything since", () => {
    const stamps: FieldStamps = { a: stamp("2026-10-05T10:00:00.000Z") };
    const out = mergeFieldAnswers({
      stored: { a: "old" },
      stamps,
      basedOn: { a: "2026-10-05T10:00:00.000Z" },
      submitted: { a: "mine", b: "new" },
      memberId: me,
    });
    expect(out.merged).toEqual({ a: "mine", b: "new" });
    expect(out.kept).toEqual([]);
  });

  it("keeps another Member's newer change to a field, and names who made it", () => {
    const out = mergeFieldAnswers({
      stored: { a: "theirs", b: "x" },
      stamps: { a: stamp("2026-10-05T10:00:05.000Z"), b: stamp("2026-10-05T10:00:00.000Z") },
      basedOn: { a: "2026-10-05T10:00:00.000Z", b: "2026-10-05T10:00:00.000Z" },
      submitted: { a: "mine", b: "mine too" },
      memberId: me,
    });
    expect(out.merged).toEqual({ a: "theirs", b: "mine too" });
    expect(out.kept).toEqual([{ field: "a", at: "2026-10-05T10:00:05.000Z", by: other, name: omar, value: "theirs" }]);
  });

  it("is no conflict when the newer change left the same value", () => {
    const out = mergeFieldAnswers({
      stored: { a: "same" },
      stamps: { a: stamp("2026-10-05T10:00:05.000Z") },
      basedOn: { a: "2026-10-05T10:00:00.000Z" },
      submitted: { a: "same" },
      memberId: me,
    });
    expect(out.kept).toEqual([]);
  });

  it("treats a field the editor had no time for as based on nothing", () => {
    const out = mergeFieldAnswers({
      stored: { a: "theirs" },
      stamps: { a: stamp("2026-10-05T10:00:05.000Z") },
      basedOn: {},
      submitted: { a: "" },
      memberId: me,
    });
    expect(out.merged).toEqual({ a: "theirs" });
    expect(out.kept).toHaveLength(1);
  });

  it("lets the editor's own earlier save be overwritten, and compares structured values by content", () => {
    const own = mergeFieldAnswers({
      stored: { a: "mine before" },
      stamps: { a: stamp("2026-10-05T10:00:05.000Z", me) },
      basedOn: { a: "2026-10-05T10:00:00.000Z" },
      submitted: { a: "mine now" },
      memberId: me,
    });
    expect(own.merged).toEqual({ a: "mine now" });
    const same = mergeFieldAnswers({
      stored: { t: { x: 1, y: [1, 2] } },
      stamps: { t: stamp("2026-10-05T10:00:05.000Z") },
      basedOn: {},
      submitted: { t: { y: [1, 2], x: 1 } },
      memberId: me,
    });
    expect(same.kept).toEqual([]);
  });

  it("keeps their value for a field the editor left out, and drops an unchanged left-out one", () => {
    const out = mergeFieldAnswers({
      stored: { a: "theirs", b: "old" },
      stamps: { a: stamp("2026-10-05T10:00:05.000Z"), b: stamp("2026-10-05T10:00:00.000Z") },
      basedOn: { a: "2026-10-05T10:00:00.000Z", b: "2026-10-05T10:00:00.000Z" },
      submitted: {},
      memberId: me,
    });
    expect(out.merged).toEqual({ a: "theirs" });
  });
});

describe("labels", () => {
  it("shows the save time in Saudi time with Latin digits, in both languages", () => {
    expect(savedLabel("2026-10-05T07:15:00.000Z", "en")).toMatch(/^Saved 10:15/);
    expect(savedLabel("2026-10-05T07:15:00.000Z", "ar")).toMatch(/^تم الحفظ 10:15/);
  });

  it("says who changed a field, just now", () => {
    expect(changedByLabel("Description", "Omar", "en")).toBe("Description changed by Omar just now");
    expect(changedByLabel("الوصف", "عمر", "ar")).toBe("الوصف: غُيّر بواسطة عمر قبل لحظات");
  });
});
