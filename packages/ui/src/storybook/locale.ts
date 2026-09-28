import { isLocale, type Locale } from "@rabaed/domain";

/** The locale chosen in Storybook's EN/AR toolbar switch (the `locale` global). */
export function storyLocale(context: { globals: Record<string, unknown> }): Locale {
  const locale = context.globals.locale;
  return typeof locale === "string" && isLocale(locale) ? locale : "en";
}

/** Picks the story copy for the current locale. */
export function storyText(context: { globals: Record<string, unknown> }, text: Record<Locale, string>): string {
  return text[storyLocale(context)];
}
