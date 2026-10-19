"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  directionOf,
  formatNumber,
  isOpenStageCategory,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Switch } from "../form/switch.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { ModalContent } from "../overlay/modal.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot, StagePill } from "../status/stage-pill.tsx";
import { tradeChipClass } from "./kanban-card.tsx";
import { menuItem } from "./list-menus.tsx";
import type { SnagListLabels, SnagNewType } from "./snag-list.tsx";
import { lookOf, placeText, type Places } from "./snag-look.ts";
import { swipeSettles, swipeWidth, type SwipeAction, type SwipeTone } from "./snag-swipe.ts";
import { ownerOf, placesOf } from "./work-item-board.tsx";
import { WorkItemPager } from "./work-item-list.tsx";

// The Snag List on a phone (RP-630, SNAG-10; design/reference/claude-design/ui_kits/app/snag-list-mobile.html):
// photo-first cards, the type chips and Need My Action in a row, the filters in a bottom sheet, a
// large "+", and behind each card the Transitions the viewer may take on it (`snag-swipe.ts`), read
// from the item itself when the card is first swiped. Every count is the API's, of the items the
// viewer sees (V1). No due date, deadline or "overdue": Step Age dots only.

/** The phone's own words. */
export type SnagPhoneLabels = {
  /** Under the chips, while there are cards: how to reach their actions. */
  swipeHint: string;
  /** The filter sheet's button that closes it, e.g. "Show 12 items". */
  showItems: (n: string, count: number) => string;
  /** The hidden button that opens a card's Transitions without a swipe, e.g. "What you can do on Cable tray not bonded". */
  transitionsOf: (subject: string) => string;
  /** Behind a card while its actions are read. */
  loadingTransitions: string;
  /** Behind a card that offers the viewer nothing to take. */
  noTransitions: string;
  /** Behind a card whose actions could not be read. */
  transitionsUnavailable: string;
};

/** What a card's swipe does: reads the Transitions the item offers the viewer (null when it can't), and opens one's Action Form. */
export type SnagSwipe = {
  load: (workItemId: string) => Promise<SwipeAction[] | null>;
  take: (workItemId: string, transitionKey: string) => void;
};

export type SnagPhoneListProps = {
  list: WorkItemListData;
  query: WorkItemQuery;
  locale: Locale;
  labels: SnagListLabels;
  hrefFor: (query: WorkItemQuery) => string;
  itemHref: (id: string) => string;
  /** A new filter, from the first page. */
  onChange: (next: Partial<WorkItemQuery>) => void;
  onQueryChange: (query: WorkItemQuery) => void;
  newTypes: readonly SnagNewType[];
  newHref: (typeCode: string) => string;
  photoUrls: Readonly<Record<string, string>>;
  linkAs: ElementType;
  swipe?: SnagSwipe;
  /** The type chips, the same as the desktop's. */
  typeChips: ReactNode;
};

/** The phone's list: chips and the Filter button, the cards, the pages, and "+". */
export function SnagPhoneList({ list, query, locale, labels, hrefFor, itemHref, onChange, onQueryChange, newTypes, newHref, photoUrls, linkAs: Link, swipe, typeChips }: SnagPhoneListProps) {
  const phone = labels.phone;
  const places = placesOf(list.filters.locations);
  const [openId, setOpenId] = useState<string | null>(null);
  const applied = query.stage.length + query.trade.length + (query.needMyAction ? 1 : 0);
  return (
    <section aria-label={labels.table} className="flex min-w-0 flex-col gap-2.5 pb-24">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 overflow-x-auto">{typeChips}</div>
        <SnagFilterSheet list={list} query={query} locale={locale} labels={labels} applied={applied} onChange={onChange} />
      </div>
      {swipe && list.items.length > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-caption text-muted">
          <Icon name="arrow-back-up" size={14} />
          {phone.swipeHint}
        </p>
      )}
      {list.items.length === 0 ? (
        <EmptyState icon="filter" title={query.q === undefined ? labels.noMatchTitle : labels.noSearchMatchTitle}>
          {null}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.items.map((row) => (
            <SnagPhoneCard
              // A card whose item moved is a new card: what it offers is read again.
              key={`${row.id}:${row.stage.key}:${row.stepEnteredAt}`}
              row={row}
              locale={locale}
              labels={labels}
              places={places}
              itemHref={itemHref}
              photoUrl={row.photo ? photoUrls[row.photo.documentId] : undefined}
              linkAs={Link}
              swipe={swipe}
              open={openId === row.id}
              onOpenChange={(open) => setOpenId(open ? row.id : null)}
            />
          ))}
        </ul>
      )}
      <WorkItemPager list={list} query={query} labels={labels} locale={locale} hrefFor={hrefFor} linkAs={Link} onQueryChange={(next) => onQueryChange({ ...query, ...next })} />
      {newTypes.length > 0 && <NewButton types={newTypes} locale={locale} labels={labels} newHref={newHref} linkAs={Link} />}
    </section>
  );
}

const toneClass: Record<SwipeTone, string> = {
  forward: "bg-primary text-on-primary",
  move: "bg-inverse text-on-inverse",
  back: "bg-surface-subtle text-text border-s border-border-subtle",
};
const toneIcon: Record<SwipeTone, IconName> = { forward: "circle-check", move: "arrow-forward-up", back: "arrow-back-up" };
/** The width behind a card that shows a line instead of buttons. */
const lineWidth = 150;

type Loaded = "loading" | "failed" | SwipeAction[];

/** One card: its first photo, the type and number, the Subject, Stage and Step Age, where it is and who holds it. */
export function SnagPhoneCard({
  row,
  locale,
  labels,
  places,
  itemHref,
  photoUrl,
  linkAs: Link,
  swipe,
  open,
  onOpenChange,
}: {
  row: WorkItemRow;
  locale: Locale;
  labels: SnagListLabels;
  places: Places;
  itemHref: (id: string) => string;
  photoUrl?: string;
  linkAs: ElementType;
  swipe?: SnagSwipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dir = directionOf(locale);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const swiped = useRef(false);

  const load = () => {
    if (!swipe || loaded !== null) return;
    setLoaded("loading");
    void swipe.load(row.id).then(
      (actions) => setLoaded(actions ?? "failed"),
      () => setLoaded("failed"),
    );
  };
  const width = Array.isArray(loaded) && loaded.length > 0 ? swipeWidth(loaded.length) : lineWidth;
  const sign = dir === "rtl" ? 1 : -1;
  const offset = drag ?? (open ? sign * width : 0);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (!swipe || event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.x;
    if (!s.moved) {
      // A vertical move is the list scrolling; only a sideways one is a swipe.
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(event.clientY - s.y)) return;
      s.moved = true;
      load();
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag goes on without it.
      }
    }
    const from = open ? sign * width : 0;
    const to = from + dx;
    // Only towards the start, and no further than the buttons and a little more.
    setDrag(dir === "rtl" ? Math.min(Math.max(0, to), width + 24) : Math.max(Math.min(0, to), -(width + 24)));
  };
  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    if (!s?.moved || drag === null) {
      setDrag(null);
      return;
    }
    swiped.current = true;
    onOpenChange(swipeSettles(drag, dir, width) === "open");
    setDrag(null);
  };

  const place = placeText(row, places, locale);
  const owner = ownerOf(row, locale, labels);
  const look = lookOf(row.type.code);
  return (
    <li className="relative overflow-hidden rounded-[16px]">
      {swipe && (open || drag !== null) && (
        <div className="absolute inset-y-0 end-0 flex" style={{ width }}>
          <SwipeButtons loaded={loaded} locale={locale} labels={labels} onTake={(key) => {
            onOpenChange(false);
            swipe.take(row.id, key);
          }} />
        </div>
      )}
      <div
        data-swipe-card=""
        data-swiped={open || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          // A swipe, or a tap on an open card (which closes it), opens nothing.
          if (swiped.current || open) {
            event.preventDefault();
            event.stopPropagation();
            swiped.current = false;
            if (open) onOpenChange(false);
          }
        }}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={cn(
          "relative flex touch-pan-y gap-3 rounded-[16px] bg-surface p-2.5 ring-1 ring-border-subtle ring-inset",
          drag === null && "transition-transform duration-200 motion-reduce:transition-none",
        )}
      >
        <Photo url={photoUrl} has={!!row.photo} label={labels.photoOf(row.title)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-muted">
            <Icon name={look.icon} size={15} className={look.mark} label={row.type.name[locale]} />
            {row.documentNumber ? <DocNo value={row.documentNumber} locale={locale} className="font-ui" /> : <span>{labels.noNumber}</span>}
            {swipe && (
              <button
                type="button"
                data-card-actions=""
                onClick={() => {
                  load();
                  onOpenChange(!open);
                }}
                className={cn("sr-only rounded-xs focus:not-sr-only focus:relative focus:z-10 focus:ms-auto focus:px-1", focusRing)}
              >
                {labels.phone.transitionsOf(row.title)}
              </button>
            )}
          </div>
          <Link
            href={itemHref(row.id)}
            dir="auto"
            draggable={false}
            className={cn("line-clamp-2 text-[15px] leading-[1.3] font-bold text-text after:absolute after:inset-0 after:rounded-[16px]", focusRing)}
          >
            {row.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <StagePill stage={stageColour(row.stage)} label={row.stage.name[locale]} locale={locale} />
            {isOpenStageCategory(row.stage.category) && row.stepAgeWeeks !== null && <AgeDots weeks={row.stepAgeWeeks} locale={locale} />}
          </div>
          {(place || owner) && (
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted">
              {place && <span>{place}</span>}
              {place && owner && <span aria-hidden="true">·</span>}
              {owner && <span className="truncate">{owner.name}</span>}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function SwipeButtons({ loaded, locale, labels, onTake }: { loaded: Loaded | null; locale: Locale; labels: SnagListLabels; onTake: (key: string) => void }) {
  const phone = labels.phone;
  if (!Array.isArray(loaded) || loaded.length === 0) {
    const text = loaded === "failed" ? phone.transitionsUnavailable : Array.isArray(loaded) ? phone.noTransitions : phone.loadingTransitions;
    return (
      <p role="status" className="flex flex-1 items-center justify-center bg-surface-subtle px-3 text-center text-caption font-semibold text-muted">
        {text}
      </p>
    );
  }
  return (
    <>
      {loaded.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={() => onTake(action.key)}
          className={cn("flex w-[75px] flex-col items-center justify-center gap-1 px-1 text-center text-caption leading-tight font-bold", toneClass[action.tone], focusRing)}
        >
          <Icon name={toneIcon[action.tone]} size={22} />
          {action.label[locale]}
        </button>
      ))}
    </>
  );
}

function Photo({ url, has, label }: { url?: string; has: boolean; label: string }) {
  return (
    <span className="relative flex size-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-surface-subtle text-faint">
      {url ? <img src={url} alt={label} className="absolute inset-0 size-full object-cover" /> : <Icon name="photo" size={22} label={has ? label : undefined} />}
    </span>
  );
}

/** The Filter button and the bottom sheet it opens: Stage, Trade and Need My Action, each applied at once. */
function SnagFilterSheet({
  list,
  query,
  locale,
  labels,
  applied,
  onChange,
}: {
  list: WorkItemListData;
  query: WorkItemQuery;
  locale: Locale;
  labels: SnagListLabels;
  applied: number;
  onChange: (next: Partial<WorkItemQuery>) => void;
}) {
  const n = (value: number) => formatNumber(value, locale);
  const total = list.stages.reduce((sum, s) => sum + s.count, 0);
  const toggle = (values: readonly string[], value: string) => (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  const chip = "inline-flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-surface-subtle px-3 text-[14px] font-semibold text-text-secondary aria-pressed:border-primary aria-pressed:bg-brand-tint aria-pressed:text-brand-fg";
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn("relative inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-control-border bg-surface text-text-secondary", focusRing)}
        >
          <Icon name="filter" size={20} label={labels.filters} />
          {applied > 0 && (
            <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center font-ui text-notes leading-5 font-bold text-on-primary">{n(applied)}</span>
          )}
        </button>
      </DialogPrimitive.Trigger>
      <ModalContent
        title={labels.filters}
        closeLabel={labels.close}
        // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
        className="inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[20px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* The kit's handle: the sheet comes up from the bottom (Escape, the scrim or the close button shut it). */}
        <span aria-hidden="true" className="absolute inset-x-0 top-2 mx-auto h-1 w-9 rounded-full bg-border-strong" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-text">{labels.stage}</legend>
          <div className="flex flex-wrap gap-2">
            {list.stages
              .filter((s) => s.category !== "draft")
              .map((s) => (
                <button key={s.key} type="button" aria-pressed={query.stage.includes(s.key)} onClick={() => onChange({ stage: toggle(query.stage, s.key) })} className={cn(chip, focusRing)}>
                  <StageDot stage={stageColour(s)} />
                  {s.name[locale]}
                </button>
              ))}
          </div>
        </fieldset>
        {list.filters.trades.length > 1 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-text">{labels.trade}</legend>
            <div className="flex flex-wrap gap-2">
              {list.filters.trades.map((v) => (
                <button key={v.id} type="button" aria-pressed={query.trade.includes(v.id)} onClick={() => onChange({ trade: toggle(query.trade, v.id) })} className={cn(chip, focusRing)}>
                  <TradeDot code={v.code} />
                  {v.name[locale]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label className="flex min-h-12 items-center gap-3 text-[15px] font-semibold text-text">
          <Switch checked={query.needMyAction} onCheckedChange={(on) => onChange({ needMyAction: on })} />
          {labels.needMyAction}
        </label>
        <div className="flex gap-2">
          {applied > 0 && (
            <Button variant="ghost" className="h-12" onClick={() => onChange({ stage: [], trade: [], needMyAction: false })}>
              {labels.clearAll}
            </Button>
          )}
          <DialogPrimitive.Close asChild>
            <Button className="h-12 flex-1">
              {labels.phone.showItems(n(total), total)}
            </Button>
          </DialogPrimitive.Close>
        </div>
      </ModalContent>
    </DialogPrimitive.Root>
  );
}

/** A Trade's colour, as a small square (its chip's text colour). */
export function TradeDot({ code }: { code: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-2.5 rounded-[3px] bg-transparent", tradeChipClass(code))}>
      <span className="size-full rounded-[3px] bg-current" />
    </span>
  );
}

/** The large "+": one Type's New page, or a menu of the Types the viewer may raise. */
function NewButton({ types, locale, labels, newHref, linkAs: Link }: { types: readonly SnagNewType[]; locale: Locale; labels: SnagListLabels; newHref: (code: string) => string; linkAs: ElementType }) {
  const look = cn(
    // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
    "fixed end-4 bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-20 inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg",
    focusRing,
  );
  if (types.length === 1) {
    const only = types[0]!;
    return (
      <Link href={newHref(only.code)} className={look}>
        <Icon name="plus" size={26} label={labels.newOfType(only.name[locale])} />
      </Link>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={look}>
          <Icon name="plus" size={26} label={labels.newItem} />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={labels.newItem} side="top" align="end" className="w-60 rounded-md p-1 shadow-lg">
        <ul>
          {types.map((t) => (
            <li key={t.code}>
              <PopoverClose asChild>
                <Link href={newHref(t.code)} className={cn(menuItem, "min-h-11")}>
                  <Icon name={lookOf(t.code).icon} size={16} className={lookOf(t.code).mark} />
                  {t.name[locale]}
                </Link>
              </PopoverClose>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
