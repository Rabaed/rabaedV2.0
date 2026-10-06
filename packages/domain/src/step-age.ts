import { formatNumber, intlLocaleOf, type Locale } from "./locale.ts";

/**
 * Step Age (GLOSSARY.md): the week a Work Item is in at its current Step,
 * counting from 1. Rabaed shows age only. The one home of the rule, for the UI
 * (AgeDots) and for places that aren't a component (emails, reports).
 */

const WEEK = 7 * 86_400_000;

/** Step Age: 1 in the first week at the Step, 2 in the second, and so on. */
export function stepAgeWeeks(enteredAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / WEEK)) + 1;
}

/**
 * The latest time an item can have entered its Step and be at least `weeks`
 * into it at `now`: the Step Age filter's bound, so the query filters by the
 * same rule `stepAgeWeeks` shows.
 */
export function enteredStepBy(weeks: number, now: Date): Date {
  return new Date(now.getTime() - (weeks - 1) * WEEK);
}

/** A Step Age as a whole week from 1: part weeks round down, anything below 1 or bad input is the first week. */
function wholeWeeks(weeks: number): number {
  return Number.isFinite(weeks) ? Math.max(Math.floor(weeks), 1) : 1;
}

/** Step Age as dots: one per week, up to 4 (4+). */
export function stepAgeDots(weeks: number): number {
  return Math.min(wholeWeeks(weeks), 4);
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

/** Step Age in words, e.g. "2 weeks at this step". */
export function stepAgeLabel(weeks: number, locale: Locale): string {
  const age = wholeWeeks(weeks);
  const form = new Intl.PluralRules(intlLocaleOf(locale)).select(age);
  return (labels[locale][form] ?? labels[locale].other).replace("#", formatNumber(age, locale));
}
