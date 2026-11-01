import { defaultLocale, locales } from "@rabaed/domain";
import { defineRouting } from "next-intl/routing";

// Rabaed opens in Arabic and ignores the browser's language (owner decision 2026-11-01, RP-1174):
// no `Accept-Language` detection, and no cookie remembering the page's language. A Member's
// switch is kept on the Member (`PUT /api/v1/me/language`), and the proxy opens the app in it.
export const routing = defineRouting({ locales, defaultLocale, localeDetection: false, localeCookie: false });
