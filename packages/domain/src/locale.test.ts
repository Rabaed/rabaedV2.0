import { describe, expect, it } from "vitest";
import { defaultLocale, directionOf, formatDate, formatDayMonthYear, formatHijriDate, formatNumber, isLocale, riyadhDay, sortedByName } from "./locale.ts";

describe("locale", () => {
  it("knows English and Arabic only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("opens in Arabic until a Member switches (RP-1174)", () => {
    expect(defaultLocale).toBe("ar");
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

describe("formatHijriDate", () => {
  // 1 Muharram 1448 was 16 June 2026 (Umm al-Qura), so 18 October 2026 is 7 Jumada I.
  const at = new Date("2026-10-18T09:00:00Z");

  it("writes the Umm al-Qura date in the language, in Latin digits", () => {
    expect(formatHijriDate(at, "ar")).toBe("7 جمادى الأولى 1448 هـ");
    expect(formatHijriDate(at, "en")).toBe("Jumada I 7, 1448 AH");
  });

  it("reads the Riyadh day, also late in the UTC day", () => {
    // 22:30 UTC on the 18th is 01:30 on the 19th in Riyadh.
    expect(formatHijriDate(new Date("2026-10-18T22:30:00Z"), "en")).toBe("Jumada I 8, 1448 AH");
  });
});

describe("riyadhDay", () => {
  it("is the calendar day in Riyadh, as YYYY-MM-DD, also late in the UTC day", () => {
    expect(riyadhDay(new Date("2026-10-10T08:00:00Z"))).toBe("2026-10-10");
    // 22:30 UTC is 01:30 the next day in Riyadh (UTC+3).
    expect(riyadhDay(new Date("2026-10-10T22:30:00Z"))).toBe("2026-10-11");
  });
});
