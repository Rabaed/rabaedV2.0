import { formatNumber, type Locale } from "@rabaed/domain";

/** Step Age as a whole week at the Step, counting from 1 (CONTEXT.md): part weeks round down, anything below 1 or bad input is the first week. */
export function wholeStepAge(weeks: number): number {
  return Number.isFinite(weeks) ? Math.max(Math.floor(weeks), 1) : 1;
}

// "N weeks at this step" per plural form (CLDR); `#` is the number in Latin digits.
const labels: Record<Locale, Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }> = {
  en: { one: "# week at this step", other: "# weeks at this step" },
  ar: {
    one: "أسبوع واحد في هذه الخطوة",
    two: "أسبوعان في هذه الخطوة",
    few: "# أسابيع في هذه الخطوة",
    many: "# أسبوعًا في هذه الخطوة",
    other: "# أسبوع في هذه الخطوة",
  },
};

/** Step Age in words, e.g. "2 weeks at this step". Rabaed shows age only. */
export function stepAgeLabel(weeks: number, locale: Locale): string {
  const age = wholeStepAge(weeks);
  const form = new Intl.PluralRules(locale).select(age);
  return (labels[locale][form] ?? labels[locale].other).replace("#", formatNumber(age, locale));
}
