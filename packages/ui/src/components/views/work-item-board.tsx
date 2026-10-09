"use client";

import {
  cardNumber,
  closedColumnDays,
  dropTargets,
  formatDate,
  formatNumber,
  isOpenStageCategory,
  lanesInLocale,
  outcomeLabel,
  outcomeLook,
  type BilingualText,
  type BoardCardLayout,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemBoardLane,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { useEffect, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot } from "../status/stage-pill.tsx";
import { KanbanCard, type KanbanCardBadge, type KanbanCardOwner, type KanbanCardPlace } from "./kanban-card.tsx";
import type { ListOutcomes } from "./work-item-list.tsx";

/**
 * The board's words, in the viewer's language, from the app's messages: the
 * package has no translations of its own. A function takes a value already
 * formatted for the viewer's locale.
 */
export type WorkItemBoardLabels = {
  /** The board region's name, e.g. "Kanban". */
  board: string;
  noNumber: string;
  revisionNoNumber: (revision: string) => string;
  /** After a Step's name, when nobody in the viewer's Company has claimed it. */
  unclaimed: string;
  /** A column with no cards. */
  noItems: string;
  closedSince: (days: string) => string;
  total: (count: string) => string;
  showAll: string;
  showAllIn: (stage: string) => string;
  move: string;
  moveItem: (subject: string) => string;
  moveTo: (stage: string) => string;
  /** Announced while a card is dragged. */
  dragging: string;
  /** The outcome of a cancelled item, as its badge; every other outcome is named by its Type's set (RP-429). */
  cancelled: string;
  /** The lane of closed items, which nobody holds (the anatomy's "Mixed"). */
  mixed: string;
  /** The Revision badge, e.g. "R2". */
  revision: (n: string) => string;
  /** A letter outcome's pill, e.g. "Code A". */
  code: (code: string) => string;
  /** The card's date, spoken: the Creation Date on my own Company's items… */
  createdOn: (date: string) => string;
  /** …and the Submission Date on anyone else's. */
  submittedOn: (date: string) => string;
};

export type WorkItemBoardProps = {
  /** The board, as the API returns it. */
  board: WorkItemBoardData;
  /** The query the board shows. */
  query: WorkItemQuery;
  locale: Locale;
  labels: WorkItemBoardLabels;
  /** The viewer's Card view layout; the board's own (`board.layout`) when left out. */
  layout?: BoardCardLayout;
  /** Names this board in the browser, so the lanes the viewer collapsed stay collapsed, e.g. the Project and Module. */
  storageKey?: string;
  /** The List's URL for `query`: where a closed column's "Show all" leads. */
  listHrefFor: (query: WorkItemQuery) => string;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  /**
   * The viewer chose to move a card by one of its Transitions (RP-350), by
   * dropping it on a column or from the card's Move menu: open that
   * Transition's Action Form. Without it, the cards can't be moved.
   */
  onMove?: (card: WorkItemRow, move: WorkItemMove) => void;
  /** E.g. negative margins and padding, so the grey canvas reaches the page's edges as the anatomy draws it. */
  className?: string;
};

type Dragging = { card: WorkItemRow; targets: Map<string, WorkItemMove> };

/** The Stages the board shows: every one but Drafts, which stay on the List, Need My Action and its Stage filter (RP-410). */
export function boardStages(board: Pick<WorkItemBoardData, "stages">): WorkItemBoardData["stages"] {
  return board.stages.filter((s) => s.category !== "draft");
}

/**
 * The Kanban of a Module's Work Items (spec RP-344, RP-349; rebuilt to the
 * owner's Kanban Board Anatomy, RP-410): a grey canvas with a white column per
 * Stage (no Drafts), running in the reading direction. Inside a column, a
 * collapsible group per Step of the viewer's own Company (its role), one per
 * other Company by its name only (V5, V14), and the closed items. A closed
 * column shows the items closed in the last 30 days, with its total and "Show
 * all", which opens the List with the same filters. Under a search the total is
 * left out: a search counts only what it shows. The board scrolls sideways in
 * its own region; columns keep their width.
 *
 * A card the viewer may act on can be dragged (RP-350): only the Stages that
 * one of its Transitions alone leads to are outlined and take a drop, which
 * opens that Transition's Action Form; a drop anywhere else does nothing. The
 * card's Move menu offers the same moves to the keyboard, screen readers and touch.
 */
export function WorkItemBoard({
  board,
  query,
  locale,
  labels,
  layout = board.layout,
  storageKey,
  listHrefFor,
  itemHref,
  linkAs: Link = "a",
  onMove,
  className,
}: WorkItemBoardProps) {
  const columns = new Map(board.columns.map((c) => [c.stageKey, c]));
  const stageNames = new Map(board.stages.map((s) => [s.key, s.name]));
  // The card being dragged, with the Stages it may be dropped on, and the one under it.
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [collapsed, toggleLane] = useCollapsedLanes(storageKey);
  const places = placesOf(board.filters.locations);
  return (
    <section
      aria-label={labels.board}
      // Focusable, so the board can be scrolled with the keyboard.
      tabIndex={0}
      data-board=""
      className={cn("relative overflow-x-auto bg-canvas pt-[18px] pb-[40px]", focusRing, className)}
    >
      {dragging && (
        <p role="status" className="sr-only">
          {labels.dragging}
        </p>
      )}
      <ol className="flex w-max items-start gap-[18px]">
        {boardStages(board).map((stage) => {
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
              data-drop-over={dropMove && over === stage.key ? "" : undefined}
              className={cn(
                // A column grows with its cards (the anatomy): the page scrolls down, the board sideways in its own region.
                "flex w-[318px] shrink-0 flex-col rounded-lg border border-border bg-surface transition-shadow",
                dropMove && "outline-2 outline-offset-2 outline-brand outline-dashed",
                dropMove && over === stage.key && "outline-solid",
              )}
              // Only a Stage one Transition alone leads to takes a drop; a drop elsewhere does nothing.
              onDragOver={
                dropMove
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (over !== stage.key) setOver(stage.key);
                    }
                  : undefined
              }
              onDragLeave={dropMove ? () => setOver((o) => (o === stage.key ? null : o)) : undefined}
              onDrop={
                dropMove
                  ? (event) => {
                      event.preventDefault();
                      onMove?.(dragging!.card, dropMove);
                      setDragging(null);
                      setOver(null);
                    }
                  : undefined
              }
            >
              <h2 id={headingId} className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-[14px] text-lg leading-6 font-bold text-text">
                <StageDot stage={stageColour(stage)} />
                <span className="min-w-0 truncate">{stage.name[locale]}</span>
                <span className="rounded-full bg-neutral-tint px-2 font-ui text-caption leading-5 font-semibold text-neutral-fg tabular-nums">
                  {formatNumber(shown, locale)}
                </span>
              </h2>
              {closed && (
                <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-2 text-caption text-muted">
                  <span>{labels.closedSince(formatNumber(closedColumnDays, locale))}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    {/* A search counts only what it shows, so it has no total to give. */}
                    {query.q === undefined && <span data-testid="column-total">{labels.total(formatNumber(stage.count, locale))}</span>}
                    <Link
                      href={listHrefFor({ ...query, stage: [stage.key], cursor: undefined })}
                      aria-label={labels.showAllIn(stage.name[locale])}
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ms-auto")}
                    >
                      {labels.showAll}
                    </Link>
                  </span>
                </div>
              )}
              <div className="flex min-h-16 flex-col px-2 py-1.5">
                {shown === 0 ? (
                  <p className="px-1 py-4 text-center text-caption text-muted">{labels.noItems}</p>
                ) : (
                  lanesInLocale(column!.lanes, locale).map((lane, index) => {
                    const key = `${stage.key}:${laneKey(lane)}`;
                    return (
                      <Lane
                        key={key}
                        lane={lane}
                        index={index}
                        open={!collapsed.has(key)}
                        onToggle={() => toggleLane(key)}
                        locale={locale}
                        labels={labels}
                        layout={layout}
                        places={places}
                        itemHref={itemHref}
                        linkAs={Link}
                        moves={onMove ? board.moves : {}}
                        stageNames={stageNames}
                        outcomes={board.filters.outcomes}
                        onMove={onMove}
                        dragging={dragging?.card.id ?? null}
                        onDragChange={(d) => {
                          setDragging(d);
                          if (!d) setOver(null);
                        }}
                      />
                    );
                  })
                )}
              </div>
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

/** The lanes the viewer collapsed, kept in this browser per board; a convenience, so it works without storage too. */
function useCollapsedLanes(storageKey: string | undefined): [Set<string>, (key: string) => void] {
  const item = storageKey ? `rabaed:board-lanes:${storageKey}` : null;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!item) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(item) ?? "[]") as unknown;
      if (Array.isArray(saved)) setCollapsed(new Set(saved.filter((k): k is string => typeof k === "string")));
    } catch {
      // No storage: every lane starts open.
    }
  }, [item]);
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (item) {
        try {
          window.localStorage.setItem(item, JSON.stringify([...next]));
        } catch {
          // Not kept: fine.
        }
      }
      return next;
    });
  return [collapsed, toggle];
}

// A lane's dot: my own Steps in turn blue, violet, cyan, green; another Company amber; closed items grey.
const stepDots = ["bg-stage-internal-dot", "bg-stage-pending-dot", "bg-trade-el-fg", "bg-stage-approved-dot"];

/** Each Location's place: itself and the Locations above it, top level first, with each one's level. */
function placesOf(locations: WorkItemBoardData["filters"]["locations"]): Map<string, { depth: number; name: BilingualText }[]> {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const out = new Map<string, { depth: number; name: BilingualText }[]>();
  for (const l of locations) {
    const path: { depth: number; name: BilingualText }[] = [];
    const seen = new Set<string>();
    for (let at: typeof l | undefined = l; at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
      seen.add(at.id);
      path.unshift({ depth: at.depth, name: at.name });
    }
    out.set(l.id, path);
  }
  return out;
}

/** One group: its holder (a Step of mine, another Company by name, or the closed items) and its cards, collapsible. */
function Lane({
  lane,
  index,
  open,
  onToggle,
  locale,
  labels,
  layout,
  places,
  itemHref,
  linkAs,
  moves,
  stageNames,
  outcomes,
  onMove,
  dragging,
  onDragChange,
}: {
  lane: WorkItemBoardLane;
  index: number;
  open: boolean;
  onToggle: () => void;
  locale: Locale;
  labels: WorkItemBoardLabels;
  layout: BoardCardLayout;
  places: Map<string, { depth: number; name: BilingualText }[]>;
  itemHref: (id: string) => string;
  linkAs: ElementType;
  moves: Record<string, WorkItemMove[]>;
  stageNames: Map<string, BilingualText>;
  /** Each Type's outcomes on the Project, for a closed card's badge (RP-429). */
  outcomes: ListOutcomes;
  onMove?: (card: WorkItemRow, move: WorkItemMove) => void;
  /** The id of the card being dragged. */
  dragging: string | null;
  onDragChange: (dragging: Dragging | null) => void;
}) {
  const name = lane.kind === "step" ? lane.step.name[locale] : lane.kind === "company" ? lane.companyName[locale] : labels.mixed;
  const dot = lane.kind === "step" ? stepDots[index % stepDots.length] : lane.kind === "company" ? "bg-stage-resubmitted-dot" : "bg-stage-cancelled-dot";
  const listId = `lane-${laneKey(lane).replace(/[^a-z0-9_-]/gi, "-")}-${index}`;
  return (
    <section aria-label={name} data-lane={lane.kind} className="flex flex-col border-border-subtle not-first:mt-1 not-first:border-t not-first:pt-1">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
          className={cn(
            "flex h-[34px] w-full items-center gap-2 rounded-sm px-2 text-start text-[13.5px] font-semibold text-text-secondary hover:bg-hover pointer-coarse:h-11",
            focusRing,
          )}
        >
          <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", dot)} />
          <span className="min-w-0 truncate">{name}</span>
          <span className="rounded-full bg-neutral-tint px-[7px] font-ui text-notes leading-[18px] font-semibold text-neutral-fg tabular-nums">
            {formatNumber(lane.count, locale)}
          </span>
          <Icon name="chevron-down" size={15} className={cn("ms-auto shrink-0 text-faint transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
        </button>
      </h3>
      <ul id={listId} hidden={!open} className="flex flex-col gap-[14px] px-1 pt-1.5 pb-[14px]">
        {lane.cards.map((card) => {
          const targets = dropTargets(moves[card.id] ?? [], card.stage.key);
          const movable = onMove !== undefined && targets.size > 0;
          return (
            <li
              key={card.id}
              data-movable={movable ? "" : undefined}
              className={cn(movable && "cursor-grab active:cursor-grabbing")}
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
              <KanbanCard
                {...cardContent(card, locale, labels, outcomes, layout, places)}
                href={itemHref(card.id)}
                linkAs={linkAs}
                selected={dragging === card.id}
                actions={movable ? <MoveMenu card={card} targets={targets} stageNames={stageNames} locale={locale} labels={labels} onMove={onMove} /> : undefined}
              />
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
  labels,
  onMove,
}: {
  card: WorkItemRow;
  targets: Map<string, WorkItemMove>;
  stageNames: Map<string, BilingualText>;
  locale: Locale;
  labels: WorkItemBoardLabels;
  onMove: (card: WorkItemRow, move: WorkItemMove) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.moveItem(card.title)}
          title={labels.move}
          className={cn("inline-flex size-6 items-center justify-center rounded-xs text-muted hover:bg-hover hover:text-text", focusRing, touchBox)}
        >
          <Icon name="arrows-move" size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={labels.moveItem(card.title)} className="flex w-64 flex-col gap-1 p-2">
        {[...targets].map(([stageKey, move]) => (
          <PopoverClose asChild key={stageKey}>
            <button
              type="button"
              onClick={() => onMove(card, move)}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto flex-col items-start gap-0 py-1.5 text-start pointer-coarse:min-h-11")}
            >
              <span>{move.label[locale]}</span>
              <span className="text-caption font-normal text-muted">{labels.moveTo(stageNames.get(stageKey)?.[locale] ?? stageKey)}</span>
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** What a card shows, as the viewer may read it (V14) and as their Card view layout asks. */
export function cardContent(
  card: WorkItemRow,
  locale: Locale,
  labels: WorkItemBoardLabels,
  outcomes: ListOutcomes,
  layout: BoardCardLayout,
  places: Map<string, { depth: number; name: BilingualText }[]>,
) {
  const open = isOpenStageCategory(card.stage.category);
  // The Creation Date on my own Company's items (the API gives it to the raiser's Participant only), else the Submission Date.
  const dateIso = card.creationDate ?? card.submissionDate;
  const dateText = dateIso === null ? null : formatDate(new Date(dateIso), locale, { month: "short", day: "numeric" });
  const place: KanbanCardPlace[] | undefined =
    card.location === null ? [] : places.get(card.location.id)?.map((p) => ({ depth: p.depth, name: p.name[locale] })) ?? [{ depth: 1, name: card.location.name[locale] }];
  return {
    // The R badge carries the Revision, so the number leaves out its " Rev n".
    number: cardNumber(card.documentNumber, card.revisionNo),
    noNumberLabel: card.revisionNo > 0 ? labels.revisionNoNumber(formatNumber(card.revisionNo, locale)) : labels.noNumber,
    title: card.title,
    badge: badgeOf(card, locale, labels, outcomes),
    trade: { code: card.trade.code, name: card.trade.name[locale] },
    typeCode: card.type.code,
    contractorName: layout.contractorName ? card.raiserCompanyName?.[locale] : undefined,
    place: layout.location ? place : undefined,
    owner: ownerOf(card, locale, labels),
    date:
      layout.creationDate && dateText !== null
        ? { text: dateText, label: card.creationDate !== null ? labels.createdOn(dateText) : labels.submittedOn(dateText) }
        : undefined,
    stepAgeWeeks: open ? card.stepAgeWeeks : null,
    locale,
  };
}

/** The outcome once issued, from its Type's set (RP-429); before that the Revision, from R1. */
function badgeOf(card: WorkItemRow, locale: Locale, labels: WorkItemBoardLabels, outcomes: ListOutcomes): KanbanCardBadge | undefined {
  if (card.outcome === "cancelled") return { kind: "plain", label: labels.cancelled };
  if (card.outcome !== null) {
    const set = outcomes.filter((o) => o.type === card.type.code);
    const found = set.find((o) => o.code === card.outcome);
    if (!found) return { kind: "plain", label: card.outcome };
    const name = outcomeLabel(found, locale);
    return { kind: "outcome", look: outcomeLook(found, set), label: found.code.length <= 3 ? labels.code(found.code) : found.name[locale], name };
  }
  return card.revisionNo > 0 ? { kind: "revision", label: labels.revision(formatNumber(card.revisionNo, locale)) } : undefined;
}

/** Who holds it (V14): my own Company's person or unclaimed Step; another Company by its name only. Nobody holds a closed item. */
function ownerOf(card: WorkItemRow, locale: Locale, labels: WorkItemBoardLabels): KanbanCardOwner | undefined {
  const w = card.with;
  if (!w || !isOpenStageCategory(card.stage.category)) return undefined;
  if (w.kind === "company") return { kind: "company", name: w.companyName[locale] };
  if (w.claimer) return { kind: "person", name: w.claimer.name[locale] };
  return { kind: "pool", name: `${w.step.name[locale]} · ${labels.unclaimed}` };
}

/** The View switch's words, from the app's messages. */
export type WorkItemViewSwitchLabels = {
  /** The switch's name, e.g. "View". */
  view: string;
  list: string;
  kanban: string;
};

export type WorkItemViewSwitchProps = {
  view: WorkItemView;
  labels: WorkItemViewSwitchLabels;
  /** The URL of each View, its filters kept. */
  hrefFor: (view: WorkItemView) => string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/** Kanban / List, as two links (the View is part of the URL): the active one filled tomato. */
export function WorkItemViewSwitch({ view, labels, hrefFor, linkAs: Link = "a" }: WorkItemViewSwitchProps) {
  return (
    <nav aria-label={labels.view} className="inline-flex overflow-hidden rounded-sm border border-border-strong bg-surface">
      {(["kanban", "list"] as const).map((v) => (
        <Link
          key={v}
          href={hrefFor(v)}
          aria-current={v === view ? "page" : undefined}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 px-[14px] text-sm font-semibold text-text-secondary hover:bg-hover pointer-coarse:min-h-11",
            "aria-[current=page]:bg-primary aria-[current=page]:text-on-primary aria-[current=page]:hover:bg-primary-hover",
            focusRing,
          )}
        >
          <Icon name={v === "list" ? "list" : "layout-grid"} size={16} />
          {labels[v]}
        </Link>
      ))}
    </nav>
  );
}
