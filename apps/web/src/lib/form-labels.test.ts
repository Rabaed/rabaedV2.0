import { readFileSync } from "node:fs";
import { locales, type Locale } from "@rabaed/domain";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { checklistTemplateLabels } from "./form-labels.ts";

// The parity test only compares the two message files with each other, so a key the
// code asks for and neither file holds passes it. Here the labels are read through a
// real translator: a missing key is an error, not the key printed on screen (RP-1055).

const messages = (locale: Locale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

/** The Form's words in `locale`, as the app reads them; `onError` hears of a missing key. */
const translator = (locale: Locale, onError?: (error: Error) => void) =>
  createTranslator({ locale, messages: messages(locale), namespace: "workItems.form", ...(onError && { onError }) });

/** Every label of a set, each function called with sample arguments. */
const allText = (labels: Record<string, unknown>): string[] =>
  Object.values(labels).map((label) => (typeof label === "function" ? (label as (...args: unknown[]) => string)("1", 1) : String(label)));

describe("a checklist_template field's words", () => {
  it.each(locales)("are all in the %s messages", (locale) => {
    const missing: string[] = [];
    allText(checklistTemplateLabels(translator(locale, (error) => missing.push(error.message))));
    expect(missing).toEqual([]);
  });

  it("name what a negative answer raises, with the answer", () => {
    expect(checklistTemplateLabels(translator("en")).raisesSnag("Fail")).toBe("Fail raises a Snag");
    expect(checklistTemplateLabels(translator("ar")).raisesSnag("راسب")).toBe("عند راسب يُنشأ عيب");
  });
});
