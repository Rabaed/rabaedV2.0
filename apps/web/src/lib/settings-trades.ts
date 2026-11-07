import type { BilingualText, Locale } from "@rabaed/domain";

// The Trades the Approved Supplier List and the Checklist Templates offer (RP-1251, after RP-1239's
// `pickable`): an archived ("deactivated") Trade is never picked anew, but a record already on one keeps it.

export type SettingsTrade = { id: string; code: string; name: BilingualText; active: boolean };

/** A Trade picker's options: the active Trades, and `own` (the record's own Trade) even when archived, labelled so. */
export function tradeOptions(trades: SettingsTrade[], locale: Locale, own?: { id: string; archivedLabel: string }) {
  return trades
    .filter((t) => t.active || t.id === own?.id)
    .map((t) => ({ value: t.id, label: t.active ? t.name[locale] : `${t.name[locale]} (${own!.archivedLabel})` }));
}

/** The Trades a settings list gives a card: every active one, and an archived one only while a record on it is listed. */
export function listedTrades<T extends SettingsTrade>(trades: T[], used: Iterable<string>): T[] {
  const on = new Set(used);
  return trades.filter((t) => t.active || on.has(t.id));
}
