import { browserLocale, defaultLocale, isLocale, type Locale } from "@rabaed/domain";

/**
 * The language the browser asks for (its own setting, not the page's URL): that
 * of the Member's emails at their first sign-in (RP-355). The page's language
 * when the browser asks for neither Arabic nor English. In the browser only.
 */
export function browserLanguage(pageLocale: string): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return browserLocale(languages, isLocale(pageLocale) ? pageLocale : defaultLocale);
}
