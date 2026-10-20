import { readFileSync } from "node:fs";
import { formatNumber, type Locale } from "@rabaed/domain";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

// RP-1022: a plural's `#` prints its count in the locale's own digits, Arabic-Indic in Arabic on
// some runtimes. These messages once used it; they now print `n`, the count through formatNumber,
// so Arabic keeps Latin digits (rabaed/json-no-plural-pound keeps new ones out).

const messages = (locale: Locale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

const counted = [
  ["workItems.fields.notPickedUpYet", "more"],
  ["handover.otherCompany", "count"],
  ["projectSettings.approvedSuppliers.approvedCount", "count"],
  ["packages.addItems.add", "count"],
  ["packages.bulk.description", "count"],
  ["packages.submit.count", "count"],
] as const;

describe.each(["en", "ar"] as const)("counted messages in %s", (locale) => {
  const t = createTranslator({ locale, messages: messages(locale) });

  it.each(counted)("%s prints the count it is given as n", (key, plural) => {
    const text = t(key, { company: "C", names: "N", count: 25, [plural]: 25, n: formatNumber(25, locale) });
    expect(text).toContain("25");
    expect(text).not.toMatch(/[٠-٩]/);
    // The count comes only from n: a plural's # would still print 25 with n left out.
    expect(t(key, { company: "C", names: "N", count: 25, [plural]: 25, n: "<n>" })).toContain("<n>");
  });
});
