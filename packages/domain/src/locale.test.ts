import { describe, expect, it } from "vitest";
import { browserLocale, directionOf, formatDate, formatDayMonthYear, formatNumber, isLocale, riyadhDay, sortedByName } from "./locale.ts";

describe("locale", () => {
  it("knows English and Arabic only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  describe("the browser's language", () => {
    it("is the first of the browser's languages that is Arabic or English, region or not", () => {
      expect(browserLocale(["ar-SA", "en-US"], "en")).toBe("ar");
      expect(browserLocale(["en-GB", "ar"], "ar")).toBe("en");
      expect(browserLocale(["fr-FR", "AR"], "en")).toBe("ar");
    });

    it("falls back to the page's language when the browser asks for neither", () => {
      expect(browserLocale(["fr-FR", "de"], "ar")).toBe("ar");
      expect(browserLocale([], "en")).toBe("en");
    });

    it("never takes a language that only starts with the same letters", () => {
      expect(browserLocale(["arn", "eno"], "ar")).toBe("ar");
      expect(browserLocale(["arn", "eno"], "en")).toBe("en");
    });
  });

  it("lays Arabic out right-to-left and English left-to-right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });

  it("keeps digits Latin in Arabic", () => {
    expect(formatNumber(1234567, "ar")).toMatch(/^[0-9٬,.]+$/);
    expect(formatNumber(1234567, "ar")).toContain("1");
    expect(formatNumber(1234567, "ar")).not.toMatch(/[٠-٩]/);
  });

  it("groups thousands in English", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });

  const sept28 = new Date("2026-09-28T09:05:00Z");

  it("keeps date digits Latin in Arabic, on the Gregorian calendar", () => {
    const text = formatDate(sept28, "ar");
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
    expect(text).toContain("2026");
    expect(text).toContain("28");
  });

  it("shows dates and times in Saudi time, the same on server and browser", () => {
    expect(formatDate(sept28, "en")).toBe("Sep 28, 2026");
    expect(formatDate(sept28, "en", { timeStyle: "short" })).toBe("12:05 PM");
    expect(formatDate(sept28, "ar", { timeStyle: "short" })).toMatch(/^12:05/);
  });

  it("keeps percentages and decimals Latin in Arabic", () => {
    expect(formatNumber(0.25, "ar", { style: "percent" })).not.toMatch(/[٠-٩۰-۹]/);
    expect(formatNumber(0.25, "en", { style: "percent" })).toBe("25%");
  });

  it("orders names in the viewer's language, not always by the English one", () => {
    const people = [
      { en: "Badr Alawi", ar: "بدر العلوي" },
      { en: "Saad Harbi", ar: "سعد الحربي" },
      { en: "Ali Sonour", ar: "علي سنور" },
    ];
    expect(sortedByName(people, (p) => p.en, "en").map((p) => p.en)).toEqual(["Ali Sonour", "Badr Alawi", "Saad Harbi"]);
    expect(sortedByName(people, (p) => p.ar, "ar").map((p) => p.ar)).toEqual(["بدر العلوي", "سعد الحربي", "علي سنور"]);
  });
});

describe("formatDayMonthYear", () => {
  // 21:30 UTC on 9 October is already 10 October in Riyadh.
  const at = new Date("2026-10-09T21:30:00Z");

  it("writes day, month and year as the design kit does, the weekday first when asked, in Saudi time", () => {
    expect(formatDayMonthYear(at, "en")).toBe("10 October 2026");
    expect(formatDayMonthYear(at, "en", { weekday: true })).toBe("Saturday, 10 October 2026");
  });

  it("writes the month short for the List, its Export and Download (RP-409)", () => {
    expect(formatDayMonthYear(at, "en", { month: "short" })).toBe("10 Oct 2026");
    expect(formatDayMonthYear(at, "ar", { month: "short" })).toMatch(/^10 .+ 2026$/);
  });

  it("keeps Arabic's own order, in Latin digits", () => {
    const ar = formatDayMonthYear(at, "ar", { weekday: true });
    expect(ar).toContain("السبت");
    expect(ar).toContain("10");
    expect(ar).toContain("2026");
    expect(ar).not.toMatch(/[٠-٩]/);
  });
});

describe("riyadhDay", () => {
  it("is the calendar day in Riyadh, as YYYY-MM-DD, also late in the UTC day", () => {
    expect(riyadhDay(new Date("2026-10-10T08:00:00Z"))).toBe("2026-10-10");
    // 22:30 UTC is 01:30 the next day in Riyadh (UTC+3).
    expect(riyadhDay(new Date("2026-10-10T22:30:00Z"))).toBe("2026-10-11");
  });
});
