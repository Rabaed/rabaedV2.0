import type { BilingualText, Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { tradeChipClass } from "../views/kanban-card.tsx";
import type { FilterChoice } from "./filter-menu.tsx";

// The filter panel's choices that several data list pages share (the List, the Snag List and
// the Packages view, RP-953), so each reads the same: a Trade as its chip, a Company by its
// name only with its mark (V14).

/** A Trade as a filter choice: its chip with its name and code, matched by either. */
export function tradeFilterChoice(trade: { id: string; code: string; name: BilingualText }, locale: Locale): FilterChoice {
  return {
    value: trade.id,
    text: `${trade.name[locale]} ${trade.code}`,
    label: (
      <span className={cn("inline-flex h-5 items-center rounded-[6px] px-1.5 text-notes font-semibold", tradeChipClass(trade.code))}>
        {trade.name[locale]} (<bdi translate="no">{trade.code}</bdi>)
      </span>
    ),
  };
}

/** A Company as a filter choice, by its Participant: its name only, with its mark (V14). */
export function companyFilterChoice(participantId: string, name: BilingualText, locale: Locale): FilterChoice {
  return {
    value: participantId,
    label: name[locale],
    mark: <Avatar name={name[locale]} initialsFrom={name.en} kind="company" size="sm" decorative className="size-5" />,
  };
}

/** The small × after the Filter button that clears every filter, joined to it (give the button `rounded-e-none`). */
export const filterClearClass = cn(
  "-ms-px inline-flex h-[34px] w-7 items-center justify-center rounded-e-sm border border-control-border bg-surface text-muted hover:bg-hover hover:text-text pointer-coarse:min-h-11 pointer-coarse:w-11",
  focusRing,
);
