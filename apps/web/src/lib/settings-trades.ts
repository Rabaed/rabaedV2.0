import type { BilingualText, Locale } from "@rabaed/domain";
import { pickable } from "./dimension-tree.ts";

// The Trades the Approved Supplier List and the Checklist Templates offer (RP-1251), by RP-1239's
// rule: a deactivated Trade is never picked anew, but a record already on one keeps it.

export type SettingsTrade = { id: string; code: string; name: BilingualText; active: boolean };

/**
 * A Trade picker's options: the active Trades, and `own` (the record's own Trade) even when
 * deactivated, its label ending in `archivedLabel` (the screen's word).
 */
export function tradeOptions(trades: SettingsTrade[], locale: Locale, archivedLabel: string, own?: string | null) {
  return pickable(trades, new Set(own ? [own] : [])).map((t) => ({
    value: t.id,
    label: t.active ? t.name[locale] : `${t.name[locale]} (${archivedLabel})`,
  }));
}

/** The Trades a settings list gives a card: every active one, and a deactivated one only while a record on it is listed. */
export function listedTrades<T extends SettingsTrade>(trades: T[], used: Iterable<string>): T[] {
  return pickable(trades, new Set(used));
}
