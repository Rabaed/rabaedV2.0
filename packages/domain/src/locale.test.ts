import { describe, expect, it } from "vitest";
import { directionOf, formatDate, formatNumber, isLocale } from "./locale.ts";

describe("locale", () => {
  it("knows English and Arabic only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
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
});
