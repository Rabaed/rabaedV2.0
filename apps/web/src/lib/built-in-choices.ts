import type { BilingualText, DimensionValues, Locale, Scope, WorkItemDetail } from "@rabaed/domain";
import type { BuiltInChoices } from "@rabaed/ui";
import { treeOrder } from "@/lib/dimension-tree";

// What a Form's Built-in Fields offer (RP-270): the Trades and Locations the
// filler's own Visibility covers, so they can always see what they raise, and
// the Project's active Scopes. An item's own values are always among them, so
// the Form shows them even when no longer offered (a deactivated Scope stays on
// the items that use it).

// Unicode left-to-right isolate and its closing pop, for codes inside labels.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

const labelled = (name: BilingualText, code: string, locale: Locale) => `${name[locale]} (${LRI}${code}${PDI})`;

/** The choices to fill a Form with, keeping `item`'s own values when it is given. */
export function fillingChoices(
  covered: DimensionValues,
  scopes: readonly Scope[],
  locale: Locale,
  item?: Pick<WorkItemDetail, "trade" | "location" | "scopes">,
): BuiltInChoices {
  const trades = covered.trade.map((v) => ({ id: v.id, label: labelled(v.name, v.code, locale) }));
  const locations = treeOrder(covered.location).map((v) => ({
    id: v.id,
    label: `${"— ".repeat(v.level)}${labelled(v.name, v.code, locale)}`,
  }));
  if (item && !trades.some((t) => t.id === item.trade.id)) {
    trades.push({ id: item.trade.id, label: labelled(item.trade.name, item.trade.code, locale) });
  }
  if (item?.location && !locations.some((l) => l.id === item.location!.id)) {
    locations.push({ id: item.location.id, label: labelled(item.location.name, item.location.code, locale) });
  }
  const own = new Set(item?.scopes.map((s) => s.id));
  return {
    trades,
    locations,
    scopes: scopes
      .filter((s) => s.active || own.has(s.id))
      .map((s) => ({ id: s.id, tradeId: s.tradeId, parentId: s.parentId, label: s.name[locale] })),
  };
}

/** The choices to read an item's Form with: just its own values, by name. */
export function readingChoices(item: WorkItemDetail, locale: Locale): BuiltInChoices {
  return {
    trades: [{ id: item.trade.id, label: labelled(item.trade.name, item.trade.code, locale) }],
    locations: item.location ? [{ id: item.location.id, label: labelled(item.location.name, item.location.code, locale) }] : [],
    scopes: item.scopes.map((s) => ({ id: s.id, tradeId: item.trade.id, parentId: s.parentId, label: s.name[locale] })),
  };
}
