import {
  closedColumnDays,
  dropTargets,
  formatNumber,
  isOpenStageCategory,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemBoardLane,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
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
  move: { en: "Move", ar: "نقل" },
  moveItem: { en: "Move #", ar: "نقل #" },
  moveTo: { en: "To #", ar: "إلى #" },
  dragging: { en: "Drop on a highlighted column to move the item.", ar: "أفلت العنصر على عمود مظلَّل لنقله." },
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
  /**
   * The viewer chose to move a card by one of its Transitions (RP-350), by
   * dropping it on a column or from the card's Move menu: open that
   * Transition's Action Form. Without it, the cards can't be moved.
   */
  onMove?: (card: WorkItemRow, move: WorkItemMove) => void;
};

type Dragging = { card: WorkItemRow; targets: Map<string, WorkItemMove> };

/**
 * The Kanban of a Module's Work Items (spec RP-344, RP-349): a column per
 * Stage, running in the reading direction (right to left in Arabic). Inside
 * a column, a swimlane per Step of the viewer's own Company and one per other
 * Company, by its name only (V14). A closed column shows the items closed in
 * the last 30 days, with its total and "Show all", which opens the List with
 * the same filters. The board scrolls sideways in its own region.
 *
 * A card the viewer may act on can be dragged (RP-350): only the Stages that
 * one of its Transitions alone leads to are highlighted and take a drop, which
 * opens that Transition's Action Form; a drop anywhere else does nothing. The
 * card's Move menu offers the same moves to the keyboard, screen readers and touch.
 */
export function WorkItemBoard({ board, query, locale, listHrefFor, itemHref, onMove }: WorkItemBoardProps) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  const columns = new Map(board.columns.map((c) => [c.stageKey, c]));
  const stageNames = new Map(board.stages.map((s) => [s.key, s.name]));
  // The card being dragged, with the Stages it may be dropped on.
  const [dragging, setDragging] = useState<Dragging | null>(null);
  return (
    <section
      aria-label={t("board")}
      // Focusable, so the board can be scrolled with the keyboard.
      tabIndex={0}
      className={cn("overflow-x-auto rounded-md pb-2", focusRing)}
    >
      {dragging && (
        <p role="status" className="sr-only">
          {t("dragging")}
        </p>
      )}
      <ol className="flex items-start gap-3">
        {board.stages.map((stage) => {
          const column = columns.get(stage.key);
          const shown = column?.shown ?? 0;
          const closed = !isOpenStageCategory(stage.category);
          const headingId = `board-column-${stage.key}`;
          const dropMove = dragging?.targets.get(stage.key);
          return (
            <li
              key={stage.key}
              aria-labelledby={headingId}
              data-stage={stage.key}
              data-drop-target={dropMove ? "" : undefined}
              className={cn(
                "flex w-72 shrink-0 flex-col gap-3 rounded-md bg-surface-subtle p-2",
                dropMove && "bg-hover outline-2 outline-dashed outline-border-strong",
              )}
              // Only a Stage one Transition alone leads to takes a drop; a drop elsewhere does nothing.
              onDragOver={
                dropMove
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  : undefined
              }
              onDrop={
                dropMove
                  ? (event) => {
                      event.preventDefault();
                      onMove?.(dragging!.card, dropMove);
                      setDragging(null);
                    }
                  : undefined
              }
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
                column!.lanes.map((lane) => (
                  <Lane
                    key={laneKey(lane)}
                    lane={lane}
                    locale={locale}
                    itemHref={itemHref}
                    moves={onMove ? board.moves : {}}
                    stageNames={stageNames}
                    onMove={onMove}
                    dragging={dragging?.card.id ?? null}
                    onDragChange={setDragging}
                  />
                ))
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
function Lane({
  lane,
  locale,
  itemHref,
  moves,
  stageNames,
  onMove,
  dragging,
  onDragChange,
}: {
  lane: WorkItemBoardLane;
  locale: Locale;
  itemHref: (id: string) => string;
  moves: Record<string, WorkItemMove[]>;
  stageNames: Map<string, { en: string; ar: string }>;
  onMove?: (card: WorkItemRow, move: WorkItemMove) => void;
  /** The id of the card being dragged. */
  dragging: string | null;
  onDragChange: (dragging: Dragging | null) => void;
}) {
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
        {lane.cards.map((card) => {
          const targets = dropTargets(moves[card.id] ?? [], card.stage.key);
          const movable = onMove !== undefined && targets.size > 0;
          return (
          <li
            key={card.id}
            data-movable={movable ? "" : undefined}
            className={cn("flex flex-col gap-1", dragging === card.id && "rounded-md outline-2 outline-dashed outline-border-strong")}
            draggable={movable || undefined}
            onDragStart={
              movable
                ? (event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", card.id);
                    onDragChange({ card, targets });
                  }
                : undefined
            }
            onDragEnd={movable ? () => onDragChange(null) : undefined}
          >
            <WorkItemCard
              number={card.documentNumber}
              noNumberLabel={card.revisionNo > 0 ? t("revisionNoNumber").replace("#", formatNumber(card.revisionNo, locale)) : t("noNumber")}
              title={card.title}
              state={cardState(card, locale, t("unclaimed"))}
              locale={locale}
              density="compact"
              href={itemHref(card.id)}
            />
            {movable && <MoveMenu card={card} targets={targets} stageNames={stageNames} locale={locale} onMove={onMove} />}
          </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The same moves as the drop targets, for the keyboard, screen readers and
 * touch: one button per Stage a card may move to, each opening its
 * Transition's Action Form.
 */
function MoveMenu({
  card,
  targets,
  stageNames,
  locale,
  onMove,
}: {
  card: WorkItemRow;
  targets: Map<string, WorkItemMove>;
  stageNames: Map<string, { en: string; ar: string }>;
  locale: Locale;
  onMove: (card: WorkItemRow, move: WorkItemMove) => void;
}) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("moveItem").replace("#", card.title)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-end pointer-coarse:min-h-11")}
        >
          {t("move")}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={t("moveItem").replace("#", card.title)} className="flex w-64 flex-col gap-1 p-2">
        {[...targets].map(([stageKey, move]) => (
          <PopoverClose asChild key={stageKey}>
            <button
              type="button"
              onClick={() => onMove(card, move)}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto flex-col items-start gap-0 py-1.5 text-start pointer-coarse:min-h-11")}
            >
              <span>{move.label[locale]}</span>
              <span className="text-caption font-normal text-muted">{t("moveTo").replace("#", (stageNames.get(stageKey) ?? { en: stageKey, ar: stageKey })[locale])}</span>
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
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
