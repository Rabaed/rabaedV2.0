import { formatNumber, sortedByName, type BilingualText, type Locale } from "@rabaed/domain";

/**
 * The values of `workItems.fields.notPickedUpYet` ("{company} · not picked up yet: {names} +{n}"), for
 * an item pooled at the viewer's own Participant (§3.4; V14 gives the names to its own Members only):
 * three names in the viewer's language's order, then how many more. The old item page's "With" and
 * the Work Item page's Transitions card both word it so (RP-1151).
 */
export function notPickedUpYetValues(company: BilingualText, names: readonly BilingualText[], locale: Locale) {
  const more = Math.max(names.length - 3, 0);
  return {
    company: company[locale],
    names: sortedByName(names, (n) => n[locale], locale)
      .slice(0, 3)
      .map((n) => n[locale])
      .join(locale === "ar" ? "، " : ", "),
    more,
    n: formatNumber(more, locale),
  };
}
