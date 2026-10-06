export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * The browser's language, as Rabaed has it: the first of `languages` (the
 * browser's, most wanted first, such as `navigator.languages`) that is Arabic
 * or English, region or not; `fallback` when it asks for neither. Sets the
 * language of a Member's emails at their first sign-in (RP-355).
 */
export function browserLocale(languages: readonly string[], fallback: Locale): Locale {
  for (const language of languages) {
    const primary = language.split("-")[0]!.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return fallback;
}

export function directionOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

// Rabaed always shows Latin digits, including in Arabic, and the Gregorian calendar.
export function intlLocaleOf(locale: Locale): string {
  return locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA";
}

/** Projects are in Saudi Arabia: dates and times read the same on the server and in any browser. */
export const timeZone = "Asia/Riyadh";

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocaleOf(locale), options).format(value);
}

/** A date (medium style by default) or, with `timeStyle`, a time, in Latin digits and Saudi time. */
export function formatDate(
  value: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone, ...options }).format(value);
}
