import { defaultLocale, locales } from "@rabaed/domain";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({ locales, defaultLocale });
