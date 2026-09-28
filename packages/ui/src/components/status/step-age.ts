import { formatNumber, type Locale } from "@rabaed/domain";

/** Whole weeks at the current Step as dots: one per week, up to 4 (4+). */
export function ageDotCount(weeks: number): number {
  return Number.isFinite(weeks) ? Math.min(Math.max(Math.floor(weeks), 0), 4) : 0;
}

// "N weeks at this step" per plural form (CLDR); `#` is the number in Latin digits.
const labels: Record<Locale, Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }> = {
  en: { one: "# week at this step", other: "# weeks at this step" },
  ar: {
    zero: "# أسبوع في هذه الخطوة",
    one: "أسبوع واحد في هذه الخطوة",
    two: "أسبوعان في هذه الخطوة",
    few: "# أسابيع في هذه الخطوة",
    many: "# أسبوعًا في هذه الخطوة",
    other: "# أسبوع في هذه الخطوة",
  },
};

/** Step Age in words, e.g. "2 weeks at this step". Age only: Rabaed sets no due dates. */
export function stepAgeLabel(weeks: number, locale: Locale): string {
  const whole = Number.isFinite(weeks) ? Math.max(Math.floor(weeks), 0) : 0;
  const form = new Intl.PluralRules(locale).select(whole);
  return (labels[locale][form] ?? labels[locale].other).replace("#", formatNumber(whole, locale));
}
