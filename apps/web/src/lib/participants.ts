import type { CompanyMembers, DimensionValues, Locale, Visibility } from "@rabaed/domain";

/** The Company's Authorized Person's name, from its Members list (every Member reads it); empty when it isn't there. */
export function authorizedPersonName(members: CompanyMembers | null, locale: Locale): string {
  return members?.members.find((m) => m.isAuthorizedPerson)?.fullName[locale] ?? "";
}

export type VisibilitySummaryText = { allTrades: string; allLocations: string; noTrades: string; noLocations: string };

/**
 * A Project Member's Visibility in one line, "Electrical · Tower 2", or "All Trades · All
 * Locations" (gap row 20). A chosen Location names its subtree; `covered` is what their
 * Participant covers, which names the values.
 */
export function visibilitySummary(
  visibility: Visibility,
  covered: DimensionValues,
  locale: Locale,
  text: VisibilitySummaryText,
): { text: string; all: boolean } {
  const part = (kind: keyof DimensionValues, all: string, none: string) => {
    const grant = visibility[kind];
    if (grant.isAll) return all;
    const names = covered[kind].filter((v) => grant.valueIds.includes(v.id)).map((v) => v.name[locale]);
    return names.length > 0 ? names.join(", ") : none;
  };
  return {
    text: `${part("trade", text.allTrades, text.noTrades)} · ${part("location", text.allLocations, text.noLocations)}`,
    all: visibility.trade.isAll && visibility.location.isAll,
  };
}
