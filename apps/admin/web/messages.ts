import type { Locale } from "@rabaed/domain";
import type { Translate } from "@rabaed/ui";
import { IntlMessageFormat } from "intl-messageformat";
import ar from "../../web/messages/ar.json";
import en from "../../web/messages/en.json";

// The builder's words are the customer app's own messages (workflowBuilder, workflowMap,
// workflowRules, projects.roles), formatted with the same ICU format and Latin digits.

type Tree = { [key: string]: string | Tree };
const messages: Record<Locale, Tree> = { en: en as Tree, ar: ar as Tree };
const intlLocale: Record<Locale, string> = { en: "en-SA", ar: "ar-SA-u-nu-latn" };
const formats = new Map<string, IntlMessageFormat>();

/** The translator for one namespace of the messages, e.g. `workflowBuilder` or `projects.roles`. */
export function messagesOf(locale: Locale, namespace: string): Translate {
  return (key, values) => {
    const path = `${namespace}.${key}`;
    let node: string | Tree | undefined = messages[locale];
    for (const part of path.split(".")) node = typeof node === "object" ? node[part] : undefined;
    if (typeof node !== "string") return path;
    const cacheKey = `${locale}:${path}`;
    let format = formats.get(cacheKey);
    if (!format) {
      format = new IntlMessageFormat(node, intlLocale[locale]);
      formats.set(cacheKey, format);
    }
    return String(format.format(values));
  };
}

/** One message by its full path. */
export const message = (locale: Locale, path: string): string => messagesOf(locale, path.slice(0, path.lastIndexOf(".")))(path.slice(path.lastIndexOf(".") + 1));

/** The names the builder gives what it adds, in English and Arabic (a Step is always named in both). */
export function builderNames() {
  const both = (key: string) => ({ en: messagesOf("en", "workflowBuilder.names")(key), ar: messagesOf("ar", "workflowBuilder.names")(key) });
  return {
    newStep: both("newStep"),
    newTransition: both("newTransition"),
    engineerReview: both("engineerReview"),
    pmReview: both("pmReview"),
    consultantEngineer: both("consultantEngineer"),
    consultantManager: both("consultantManager"),
    send: both("send"),
    return: both("return"),
  };
}
