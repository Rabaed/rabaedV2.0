"use client";

import { formatNumber, type BilingualText, type ChecklistAnswers, type Locale, type ReplyChecklistRead } from "@rabaed/domain";
import { cn } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { inspectionTally, itemFilters, itemsShown, type InspectionTally, type ItemFilter } from "@/lib/inspection";

// What a WIR's page parts share (RP-655): who its Comments and Snags go to, whose the answers stay
// until sent, and the Consultant Engineer's answers as typed; and the tiles and filter chips over a
// checklist. The reply checklist, the summary bar and the pop-ups read them.

/** What the WIR's parts share on its page: who the Comments and Snags go to, and the checklists' answers as they are typed. */
export type Inspection = {
  /** The raiser's Company: its Comments and Snags are assigned to it. */
  raiser: BilingualText;
  /** The Company holding the item, the viewer's own when they answer it: whose the answers stay until sent. */
  holder: BilingualText | null;
  /** The reply checklists the viewer answers, as read with the page. */
  checklists: readonly ReplyChecklistRead[];
  /** Their answers as typed now, by field key: the summary bar and Send to Manager read these. */
  answers: Readonly<Record<string, ChecklistAnswers>>;
  setAnswers: (fieldKey: string, answers: ChecklistAnswers) => void;
};

const InspectionContext = createContext<Inspection | null>(null);

/** The WIR page's parts, inside a WIR's page only; null anywhere else (any other Type's pop-ups stay as they are). */
export const useInspection = () => useContext(InspectionContext);

export function InspectionProvider({
  raiser,
  holder,
  checklists,
  children,
}: {
  raiser: BilingualText;
  holder: BilingualText | null;
  checklists: readonly ReplyChecklistRead[];
  children: ReactNode;
}) {
  const [answers, setAll] = useState<Record<string, ChecklistAnswers>>(() => Object.fromEntries(checklists.map((c) => [c.fieldKey, c.answers])));
  const setAnswers = useCallback((fieldKey: string, next: ChecklistAnswers) => setAll((current) => ({ ...current, [fieldKey]: next })), []);
  const value = useMemo(() => ({ raiser, holder, checklists, answers, setAnswers }), [raiser, holder, checklists, answers, setAnswers]);
  return <InspectionContext.Provider value={value}>{children}</InspectionContext.Provider>;
}

/** The tally over several checklists: the sum of each one's. */
export function tallyOf(checklists: readonly { items: ReplyChecklistRead["items"]; answers: ChecklistAnswers }[]): InspectionTally {
  return checklists
    .map((c) => inspectionTally(c.items, c.answers))
    .reduce((sum, t) => ({ passed: sum.passed + t.passed, failed: sum.failed + t.failed, na: sum.na + t.na, answered: sum.answered + t.answered, total: sum.total + t.total }), {
      passed: 0,
      failed: 0,
      na: 0,
      answered: 0,
      total: 0,
    });
}

/** The four tiles over a checklist: Pass, Fail, N/A, and how many are answered (or, once read, how many items). */
export function InspectionTiles({ tally, locale, answeredOf = true }: { tally: InspectionTally; locale: Locale; answeredOf?: boolean }) {
  const t = useTranslations("workItems.inspection");
  const tiles = [
    { value: formatNumber(tally.passed, locale), label: t("tiles.pass"), tone: "text-success-fg" },
    { value: formatNumber(tally.failed, locale), label: t("tiles.fail"), tone: "text-danger-fg" },
    { value: formatNumber(tally.na, locale), label: t("tiles.na"), tone: "text-text" },
    answeredOf
      ? { value: `${formatNumber(tally.answered, locale)}/${formatNumber(tally.total, locale)}`, label: t("tiles.answered"), tone: "text-text" }
      : { value: formatNumber(tally.total, locale), label: t("tiles.items"), tone: "text-text" },
  ];
  return (
    <dl className="grid grid-cols-4 gap-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex flex-col-reverse items-center gap-0.5 rounded-md border border-border bg-surface px-2 py-3">
          <dt className="text-caption text-muted">{tile.label}</dt>
          <dd className={cn("font-display text-h5 font-bold tabular-nums", tile.tone)}>
            <bdi dir="ltr">{tile.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The filter chips: All, Unanswered, Failed, each with its count. */
export function InspectionChips({
  items,
  answers,
  filter,
  locale,
  onFilter,
}: {
  items: ReplyChecklistRead["items"];
  answers: ChecklistAnswers;
  filter: ItemFilter;
  locale: Locale;
  onFilter: (filter: ItemFilter) => void;
}) {
  const t = useTranslations("workItems.inspection");
  return (
    <div role="group" aria-label={t("filters.label")} className="flex flex-wrap gap-2">
      {itemFilters.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={filter === f}
          onClick={() => onFilter(f)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold md:min-h-9",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            filter === f ? "border-inverse bg-inverse text-on-inverse" : "border-border bg-surface text-text hover:bg-hover",
          )}
        >
          {t(`filters.${f}`)}
          <span className={cn("rounded-full px-1.5 text-caption tabular-nums", filter === f ? "bg-on-inverse/20" : "bg-surface-subtle text-muted")}>
            {formatNumber(itemsShown(items, answers, f).length, locale)}
          </span>
        </button>
      ))}
    </div>
  );
}
