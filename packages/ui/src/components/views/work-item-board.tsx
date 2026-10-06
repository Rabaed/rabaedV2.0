import {
  closedColumnDays,
  formatNumber,
  isOpenStageCategory,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemBoardLane,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { WithChip } from "../status/with-chip.tsx";
import { WorkItemCard, type WorkItemState } from "../status/work-item-card.tsx";
import { Outcome } from "./work-item-list.tsx";

const copy = {
  board: { en: "Kanban", ar: "كانبان" },
  noNumber: { en: "No number yet", ar: "بلا رقم بعد" },
  revisionNoNumber: { en: "Revision #: no number yet", ar: "المراجعة #: بلا رقم بعد" },
  unclaimed: { en: "unclaimed", ar: "لم تُستلَم" },
  empty: { en: "No items", ar: "لا توجد عناصر" },
  closedSince: { en: "Closed in the last # days", ar: "أُغلقت خلال آخر # يومًا" },
  total: { en: "# in total", ar: "# إجمالًا" },
  showAll: { en: "Show all", ar: "عرض الكل" },
  showAllIn: { en: "Show all in #", ar: "عرض الكل في #" },
  view: { en: "View", ar: "طريقة العرض" },
  list: { en: "List", ar: "قائمة" },
  kanban: { en: "Kanban", ar: "كانبان" },
} satisfies Record<string, Record<Locale, string>>;

export type WorkItemBoardProps = {
  /** The board, as the API returns it. */
  board: WorkItemBoardData;
  /** The query the board shows. */
  query: WorkItemQuery;
  locale: Locale;
  /** The List's URL for `query`: where a closed column's "Show all" leads. */
  listHrefFor: (query: WorkItemQuery) => string;
  /** An item's page. */
  itemHref: (id: string) => string;
};

/**
 * The Kanban of a Module's Work Items (spec RP-344, RP-349): a column per
 * Stage, running in the reading direction (right to left in Arabic). Inside
 * a column, a swimlane per Step of the viewer's own Company and one per other
 * Company, by its name only (V14). A closed column shows the items closed in
 * the last 30 days, with its total and "Show all", which opens the List with
 * the same filters. The board scrolls sideways in its own region.
 */
export function WorkItemBoard({ board, query, locale, listHrefFor, itemHref }: WorkItemBoardProps) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  const columns = new Map(board.columns.map((c) => [c.stageKey, c]));
  return (
    <section
      aria-label={t("board")}
      // Focusable, so the board can be scrolled with the keyboard.
      tabIndex={0}
      className={cn("overflow-x-auto rounded-md pb-2", focusRing)}
    >
      <ol className="flex items-start gap-3">
        {board.stages.map((stage) => {
          const column = columns.get(stage.key);
          const shown = column?.shown ?? 0;
          const closed = !isOpenStageCategory(stage.category);
          const headingId = `board-column-${stage.key}`;
          return (
            <li
              key={stage.key}
              aria-labelledby={headingId}
              data-stage={stage.key}
              className="flex w-72 shrink-0 flex-col gap-3 rounded-md bg-surface-subtle p-2"
            >
              <h2 id={headingId} className="flex items-center justify-between gap-2 px-1 pt-1">
                <StagePill stage={stageColour(stage)} label={stage.name[locale]} count={shown} locale={locale} />
              </h2>
              {closed && (
                <div className="flex flex-col gap-1 px-1 text-caption text-muted">
                  <span>{t("closedSince").replace("#", formatNumber(closedColumnDays, locale))}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span data-testid="column-total">{t("total").replace("#", formatNumber(stage.count, locale))}</span>
                    <a
                      href={listHrefFor({ ...query, stage: [stage.key], cursor: undefined })}
                      aria-label={t("showAllIn").replace("#", stage.name[locale])}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      {t("showAll")}
                    </a>
                  </span>
                </div>
              )}
              {shown === 0 ? (
                <p className="px-1 pb-1 text-caption text-muted">{t("empty")}</p>
              ) : (
                column!.lanes.map((lane) => <Lane key={laneKey(lane)} lane={lane} locale={locale} itemHref={itemHref} />)
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function laneKey(lane: WorkItemBoardLane): string {
  return lane.kind === "step" ? `step:${lane.step.key}` : lane.kind === "company" ? `company:${lane.participantId}` : "closed";
}

/** One swimlane: its holder (a Step of mine, or another Company by name) and its cards. Closed items have no holder to show. */
function Lane({ lane, locale, itemHref }: { lane: WorkItemBoardLane; locale: Locale; itemHref: (id: string) => string }) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  const name = lane.kind === "step" ? lane.step.name[locale] : lane.kind === "company" ? lane.companyName[locale] : null;
  return (
    <section aria-label={name ?? undefined} data-lane={lane.kind} className="flex flex-col gap-2">
      {name !== null && (
        <h3 className="flex items-center justify-between gap-2 px-1 text-caption font-semibold text-muted">
          {lane.kind === "company" ? <WithChip kind="company" inViewerCompany={false} companyName={name} /> : <span>{name}</span>}
          <span className="tabular-nums">{formatNumber(lane.count, locale)}</span>
        </h3>
      )}
      <ul className="flex flex-col gap-2">
        {lane.cards.map((card) => (
          <li key={card.id}>
            <WorkItemCard
              number={card.documentNumber}
              noNumberLabel={card.revisionNo > 0 ? t("revisionNoNumber").replace("#", formatNumber(card.revisionNo, locale)) : t("noNumber")}
              title={card.title}
              state={cardState(card, locale, t("unclaimed"))}
              locale={locale}
              density="compact"
              href={itemHref(card.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Open: its Step Age, and who in my own Company has claimed it (V14); closed: its Review Code or Inspection Result. */
function cardState(card: WorkItemRow, locale: Locale, unclaimed: string): WorkItemState | undefined {
  if (isOpenStageCategory(card.stage.category)) {
    const w = card.with;
    const holder =
      w?.kind === "own"
        ? w.claimer
          ? ({ kind: "person", inViewerCompany: true, name: w.claimer.name[locale], companyName: w.companyName[locale] } as const)
          : ({ kind: "pool", inViewerCompany: true, stepName: w.step.name[locale], unclaimedLabel: unclaimed, companyName: w.companyName[locale] } as const)
        : undefined;
    return { open: true, stepAgeWeeks: card.stepAgeWeeks, ...(holder ? { holder } : {}) };
  }
  return card.outcome ? { open: false, badge: <Outcome outcome={card.outcome} locale={locale} /> } : undefined;
}

export type WorkItemViewSwitchProps = {
  view: WorkItemView;
  locale: Locale;
  /** The URL of each View, its filters kept. */
  hrefFor: (view: WorkItemView) => string;
};

/** List / Kanban, as two links: the View is part of the URL. */
export function WorkItemViewSwitch({ view, locale, hrefFor }: WorkItemViewSwitchProps) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  return (
    <nav aria-label={t("view")} className="inline-flex rounded-md border border-border p-0.5">
      {(["list", "kanban"] as const).map((v) => (
        <a
          key={v}
          href={hrefFor(v)}
          aria-current={v === view ? "page" : undefined}
          className={cn(buttonVariants({ variant: v === view ? "secondary" : "ghost", size: "sm" }), "pointer-coarse:min-h-11")}
        >
          {t(v)}
        </a>
      ))}
    </nav>
  );
}
