import { isLocale } from "@rabaed/domain";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.ts";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
