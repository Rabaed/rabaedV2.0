export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

// Rabaed always shows Latin digits, including in Arabic.
export function intlLocaleOf(locale: Locale): string {
  return locale === "ar" ? "ar-SA-u-nu-latn" : "en-SA";
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocaleOf(locale)).format(value);
}
