"use client";

import {
  formatNumber,
  isFilteredWorkItemQuery,
  isOpenStageCategory,
  raisedFromManual,
  searchMaxLength,
  withoutFilters,
  type BilingualText,
  type Locale,
  type RaisedFromSource,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { useEffect, useId, useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, buttonVariants } from "../button/button.tsx";
import { Avatar } from "../data/avatar.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { FilterMenu, FilterValues, type FilterChoice, type FilterMenuField } from "../list/filter-menu.tsx";
import { ListToolbar, ToolbarSearch, ToolbarSwitch } from "../list/list-toolbar.tsx";
import { TableCard } from "../list/table-card.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot, StagePill } from "../status/stage-pill.tsx";
import { HeaderBadge, poolIcon, tradeChipClass } from "./kanban-card.tsx";
import { menuItem } from "./list-menus.tsx";
import { SnagBulkBar, type SnagBulkActions, type SnagReportActions } from "./snag-bulk.tsx";
import { snagExcel, type SnagExportLabels } from "./snag-export.ts";
import { lookOf, placeText, type Places } from "./snag-look.ts";
import { SnagPhoneList, type SnagPhoneLabels, type SnagSwipe } from "./snag-phone.tsx";
import { saveFile } from "./work-item-export.ts";
import { ownerOf, placesOf } from "./work-item-board.tsx";
import { locationLevels, WorkItemPager } from "./work-item-list.tsx";

// The Snag List's desktop views (RP-94, SNAG-8; design/reference/claude-design/ui_kits/app/snag-list.html):
// a toolbar ("+ New" with only the Types the viewer may raise, search, Filters, Need My Action,
// List / Kanban), the type chips (All and each of the Module's Types, with how many the viewer
// sees), the List grouped by Stage in folding groups, and the Kanban with a column per Stage.
// Every count is the API's, of the items the viewer sees (V1); "With" follows V14 (ownerOf).
// No due date, deadline or "overdue": Step Age dots only.

/** The views' words, from the app's messages. */
export type SnagListLabels = {
  toolbar: string;
  search: string;
  searchPlaceholder: string;
  searchHelp: string;
  filters: string;
  clearAll: string;
  done: string;
  close: string;
  filtersApplied: (n: string, count: number) => string;
  clear: string;
  clearField: string;
  searchValues: string;
  noMatches: string;
  needMyAction: string;
  /** "+ New" with several Types to choose from. */
  newItem: string;
  /** "+ New" of one Type, e.g. "New Snag". */
  newOfType: (type: string) => string;
  /** The type chips' group, e.g. "Types". */
  types: string;
  /** The chip of every Type. */
  allTypes: string;
  stage: string;
  trade: string;
  company: string;
  raisedFrom: string;
  /** A Location level with no name of its own, e.g. "Level 2". */
  level: (n: string) => string;
  /** The "Raised from" of an item raised by hand. */
  raisedManually: string;
  /** The table's caption, e.g. "Snag List". */
  table: string;
  columns: { documentNumber: string; subject: string; type: string; trade: string; location: string; raisedFrom: string; with: string; stepAge: string; photo: string };
  /** A Stage group's count, e.g. "13 items". */
  items: (n: string, count: number) => string;
  /** A Stage group's fold button, e.g. "Hide Open" / "Show Open". */
  hideGroup: (stage: string) => string;
  showGroup: (stage: string) => string;
  noNumber: string;
  /** After a Step's name, when nobody in the viewer's Company has picked it up. */
  notPickedUp: string;
  /** A short Review Code's pill, e.g. "Code B". */
  code: (code: string) => string;
  /** A thumbnail's text, e.g. "Photo of Cable tray not bonded". */
  photoOf: (subject: string) => string;
  /** The Kanban's name, and an empty column's line. */
  board: string;
  noItems: string;
  /** No item the viewer sees at all. */
  emptyTitle: string;
  emptyBody: string;
  /** Items exist, but none match. */
  noMatchTitle: string;
  noSearchMatchTitle: string;
  clearFilters: string;
  pages: string;
  rowsPerPage: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  page: (page: string) => string;
  pageOf: (page: string, last: string) => string;
  /** The phone's own words (RP-630). */
  phone: SnagPhoneLabels;
};

/**
 * The List's bulk actions and Excel export (RP-629): rows chosen with checkboxes, then Reassign, Move Stage
 * or Export on the bar; and the toolbar's Export of every row the filters match. Without it the List has none.
 */
export type SnagBulk = {
  actions: SnagBulkActions;
  exportLabels: SnagExportLabels;
  /** Every row the viewer reads with the List's filters (null when it couldn't be read). */
  loadExportRows: () => Promise<{ items: WorkItemRow[]; capped: boolean } | null>;
  /** "Export PDF" (RP-677): the Snag report, made by the worker. */
  report: SnagReportActions;
};

/** A Type the viewer may raise, for "+ New". */
export type SnagNewType = { code: string; name: BilingualText };

type SnagListData = Pick<WorkItemListData, "stages" | "filters" | "typeCounts">;

export type SnagListProps = {
  /** The List's page, or the Kanban's board, as the API returns it. */
  data: ({ view: "list" } & { list: WorkItemListData }) | ({ view: "kanban" } & { board: WorkItemBoardData });
  query: WorkItemQuery;
  locale: Locale;
  labels: SnagListLabels;
  /** The view's URL for `query`: a chip, a page. */
  hrefFor: (query: WorkItemQuery) => string;
  itemHref: (id: string) => string;
  onQueryChange: (query: WorkItemQuery) => void;
  /** The Types the viewer may raise in the Module; "+ New" offers only these, and is left out without any. */
  newTypes: readonly SnagNewType[];
  /** The New item page for a Type. */
  newHref: (typeCode: string) => string;
  /** The thumbnails' image URLs, by Document id, as they arrive. */
  photoUrls?: Readonly<Record<string, string>>;
  /** At the toolbar's end: the List / Kanban switch. */
  viewSwitch?: ReactNode;
  /** Bulk select and Excel export in the List; the Kanban has neither. */
  bulk?: SnagBulk;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** On a phone, the List's cards' swipe actions (RP-630). Without it the cards have none. */
  swipe?: SnagSwipe;
  /** On a phone, "+"'s page for a Type (the camera-first New Snag, RP-630); defaults to `newHref`. */
  phoneNewHref?: (typeCode: string) => string;
};

/** An item's Type, as a chip: its shape, its name. */
export function SnagTypeChip({ code, name, className }: { code: string; name: string; className?: string }) {
  const look = lookOf(code);
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-[6px] px-1.5 text-caption font-semibold whitespace-nowrap", look.classes, className)}>
      <Icon name={look.icon} size={13} />
      {name}
    </span>
  );
}

const dash = <span className="text-faint">—</span>;

/** The views of the Snag List: the toolbar and type chips over the List or the Kanban. */
export function SnagList({
  data,
  query,
  locale,
  labels,
  hrefFor,
  itemHref,
  onQueryChange,
  newTypes,
  newHref,
  photoUrls = {},
  viewSwitch,
  bulk,
  linkAs: Link = "a",
  swipe,
  phoneNewHref = newHref,
}: SnagListProps) {
  const list: SnagListData = data.view === "list" ? data.list : data.board;
  const n = (value: number) => formatNumber(value, locale);
  // Rows chosen on this page: a new page, filter or sort starts with none.
  const pageKey = data.view === "list" ? data.list.items.map((i) => i.id).join(",") : "";
  const [selection, setSelection] = useState<{ page: string; ids: ReadonlySet<string> }>({ page: pageKey, ids: new Set() });
  const selected = selection.page === pageKey ? selection.ids : new Set<string>();
  const select = (ids: ReadonlySet<string>) => setSelection({ page: pageKey, ids });
  // Excel: the chosen rows, or every row the filters match; a line says what was written.
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportRows = async (rows: () => Promise<{ items: WorkItemRow[]; capped: boolean } | null>) => {
    if (!bulk) return;
    setExporting(true);
    setExportNote(null);
    try {
      const got = await rows();
      if (got === null) {
        setExportNote(bulk.actions.labels.exportFailed);
        return;
      }
      saveFile(snagExcel(got.items, locale, bulk.exportLabels, list.filters.locations));
      const count = got.items.length;
      setExportNote(got.capped ? bulk.actions.labels.exportedCapped(n(count), count) : bulk.actions.labels.exported(n(count), count));
    } catch {
      setExportNote(bulk.actions.labels.exportFailed);
    } finally {
      setExporting(false);
    }
  };
  // The PDF report (RP-677): asked for, then asked after until the worker has made it.
  const [report, setReport] = useState<{ status: "asking" | "preparing" | "ready" | "failed"; id?: string; url?: string; count?: number } | null>(null);
  const exportPdf = async (ids: string[] | null) => {
    if (!bulk) return;
    setReport({ status: "asking" });
    try {
      const asked = await bulk.report.request(ids);
      setReport(asked === null ? { status: "failed" } : { status: asked.status, id: asked.id, count: asked.count ?? undefined });
    } catch {
      setReport({ status: "failed" });
    }
  };
  const polledId = report?.status === "preparing" ? report.id : undefined;
  useEffect(() => {
    if (!bulk || polledId === undefined) return;
    let stopped = false;
    const timer = setInterval(() => {
      void bulk.report
        .check(polledId)
        .then((got) => {
          if (stopped || !got || got.status === "preparing") return;
          setReport((was) => (was?.id === polledId ? { status: got.status, id: polledId, url: got.url ?? undefined, count: was.count } : was));
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bulk, polledId]);
  // A new filter starts again from the first page.
  const change = (next: Partial<WorkItemQuery>) => {
    const { cursor: _cursor, page: _page, ...rest } = query;
    onQueryChange({ ...rest, ...next });
  };
  const filtered = isFilteredWorkItemQuery(query);
  const total = list.stages.reduce((sum, s) => sum + s.count, 0);
  const places = placesOf(list.filters.locations);

  const valueLabels = { clear: labels.clearField, search: labels.searchValues, noMatches: labels.noMatches };
  const many = (key: "stage" | "trade" | "company" | "raisedFrom", label: string, choices: FilterChoice[]): FilterMenuField => ({
    key,
    label,
    count: query[key].length,
    content: <FilterValues label={label} values={query[key]} choices={choices} labels={valueLabels} onChange={(values) => change({ [key]: values })} />,
  });
  const fields: FilterMenuField[] = [
    many(
      "stage",
      labels.stage,
      list.stages.map((s) => ({ value: s.key, label: s.name[locale], mark: <StageDot stage={stageColour(s)} /> })),
    ),
    many(
      "trade",
      labels.trade,
      list.filters.trades.map((v) => ({
        value: v.id,
        text: `${v.name[locale]} ${v.code}`,
        label: (
          <span className={cn("inline-flex h-5 items-center rounded-[6px] px-1.5 text-notes font-semibold", tradeChipClass(v.code))}>
            {v.name[locale]} (<bdi translate="no">{v.code}</bdi>)
          </span>
        ),
      })),
    ),
    ...locationLevels(list.filters.locations, locale, labels).map(
      (level): FilterMenuField => ({
        key: `location-${level.key}`,
        label: level.label,
        hint: level.hint,
        count: query.location.filter((id) => level.ids.has(id)).length,
        content: (
          <FilterValues
            label={level.label}
            hint={level.hint}
            values={query.location.filter((id) => level.ids.has(id))}
            choices={level.choices}
            labels={valueLabels}
            onChange={(values) => change({ location: [...query.location.filter((id) => !level.ids.has(id)), ...values] })}
          />
        ),
      }),
    ),
    // Each Company by its name only (V14).
    many(
      "company",
      labels.company,
      (list.filters.companies ?? []).map((c) => ({
        value: c.participantId,
        label: c.name[locale],
        mark: <Avatar name={c.name[locale]} initialsFrom={c.name.en} kind="company" size="sm" decorative className="size-5" />,
      })),
    ),
    // A source by its Document Number and Subject only (E1).
    many("raisedFrom", labels.raisedFrom, [
      ...(list.filters.raisedFrom ?? []).map((s) => ({
        value: s.documentNumber,
        text: `${s.documentNumber} ${s.subject}`,
        label: (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <DocNo value={s.documentNumber} locale={locale} className="font-ui text-caption text-muted" />
            <span dir="auto">{s.subject}</span>
          </span>
        ),
      })),
      { value: raisedFromManual, label: labels.raisedManually },
    ]),
  ];

  const newAction = <NewMenu types={newTypes} locale={locale} labels={labels} newHref={newHref} linkAs={Link} />;
  const clearLink = (
    <Link href={hrefFor(withoutFilters(query))} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
      {labels.clearFilters}
    </Link>
  );

  let body: ReactNode;
  if (total === 0 && !filtered) {
    body = (
      <EmptyState icon="circle-check" title={labels.emptyTitle} action={newTypes.length > 0 ? newAction : undefined}>
        {labels.emptyBody}
      </EmptyState>
    );
  } else if (data.view === "list" && data.list.items.length === 0) {
    body = (
      <EmptyState icon="filter" title={query.q === undefined ? labels.noMatchTitle : labels.noSearchMatchTitle} action={clearLink}>
        {null}
      </EmptyState>
    );
  } else if (data.view === "list") {
    body = (
      <SnagTable
        list={data.list}
        query={query}
        locale={locale}
        labels={labels}
        places={places}
        itemHref={itemHref}
        hrefFor={hrefFor}
        photoUrls={photoUrls}
        linkAs={Link}
        onQueryChange={change}
        bulk={
          bulk && {
            bulk,
            selected,
            onSelect: select,
            exporting,
            onExport: (rows) => void exportRows(async () => ({ items: rows, capped: false })),
            reporting: report?.status === "asking" || report?.status === "preparing",
            onExportPdf: (ids) => void exportPdf(ids),
          }
        }
      />
    );
  } else {
    body = <SnagBoard board={data.board} locale={locale} labels={labels} places={places} itemHref={itemHref} photoUrls={photoUrls} linkAs={Link} />;
  }

  // Below `md` the List is the phone's cards (RP-630); the Kanban, and a Module with no item at all, look the same everywhere.
  const phone = data.view === "list" && !(total === 0 && !filtered);
  const desktop = (
    <div className={cn("flex min-w-0 flex-col gap-3", phone && "max-md:hidden")}>
      <ListToolbar label={labels.toolbar} end={viewSwitch} className="gap-1.5">
        {newTypes.length > 0 && newAction}
        <ToolbarSearch
          tall
          key={query.q ?? ""}
          value={query.q}
          label={labels.search}
          placeholder={labels.searchPlaceholder}
          maxLength={searchMaxLength}
          description={labels.searchHelp}
          onSearch={(q) => change({ q })}
          hintWide
          className="sm:w-[240px] min-[1440px]:w-[280px]"
        />
        <FilterMenu
          fields={fields}
          labels={{ filters: labels.filters, clearAll: labels.clearAll, done: labels.done, close: labels.close, applied: labels.filtersApplied, number: n }}
          onClearAll={() => change({ stage: [], trade: [], location: [], company: [], raisedFrom: [] })}
        />
        <ToolbarSwitch label={labels.needMyAction} checked={query.needMyAction} onCheckedChange={(on) => change({ needMyAction: on })} />
        {filtered && (
          <Link href={hrefFor(withoutFilters(query))} className={cn("inline-flex h-[34px] items-center rounded-sm px-2.5 text-[13.5px] font-semibold text-brand-fg hover:bg-hover", focusRing)}>
            {labels.clear}
          </Link>
        )}
        {bulk && data.view === "list" && total > 0 && (
          <Button variant="secondary" size="sm" disabled={exporting} onClick={() => void exportRows(bulk.loadExportRows)} className="h-[34px]">
            <Icon name="file-download" />
            {bulk.actions.labels.exportAll}
          </Button>
        )}
        {bulk && data.view === "list" && total > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={report?.status === "asking" || report?.status === "preparing"}
            onClick={() => void exportPdf(null)}
            className="h-[34px]"
          >
            <Icon name="file-text" />
            {bulk.report.labels.exportPdf}
          </Button>
        )}
      </ListToolbar>
      {bulk && report !== null && (
        <p role="status" className="text-caption text-muted">
          {report.status === "asking" || report.status === "preparing" ? (
            bulk.report.labels.preparing
          ) : report.status === "failed" ? (
            bulk.report.labels.failed
          ) : report.url ? (
            <a href={report.url} className={cn("font-semibold text-brand-fg underline", focusRing)}>
              {bulk.report.labels.download(n(report.count ?? 0), report.count ?? 0)}
            </a>
          ) : null}
        </p>
      )}
      {exportNote !== null && (
        <p role="status" className="text-caption text-muted">
          {exportNote}
        </p>
      )}
      <TypeChips list={list} query={query} locale={locale} labels={labels} hrefFor={hrefFor} linkAs={Link} />
      {body}
    </div>
  );
  if (!phone || data.view !== "list") return desktop;
  return (
    <>
      {desktop}
      <div className="md:hidden">
        <SnagPhoneList
          list={data.list}
          query={query}
          locale={locale}
          labels={labels}
          hrefFor={hrefFor}
          itemHref={itemHref}
          onChange={change}
          onQueryChange={onQueryChange}
          newTypes={newTypes}
          newHref={phoneNewHref}
          photoUrls={photoUrls}
          linkAs={Link}
          swipe={swipe}
          typeChips={<TypeChips list={list} query={query} locale={locale} labels={labels} hrefFor={hrefFor} linkAs={Link} phone />}
        />
      </div>
    </>
  );
}

/** "+ New": one Type's link, or a menu of the Types the viewer may raise. */
function NewMenu({ types, locale, labels, newHref, linkAs: Link }: { types: readonly SnagNewType[]; locale: Locale; labels: SnagListLabels; newHref: (code: string) => string; linkAs: ElementType }) {
  const id = useId();
  const look = cn(buttonVariants(), "h-[34px] px-3");
  if (types.length === 1) {
    const only = types[0]!;
    return (
      <Link href={newHref(only.code)} className={look}>
        <Icon name="plus" />
        {labels.newOfType(only.name[locale])}
      </Link>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={look}>
          <Icon name="plus" />
          {labels.newItem}
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={`${id}-title`} align="start" className="w-56 rounded-md p-1 shadow-lg">
        <h2 id={`${id}-title`} className="sr-only">
          {labels.newItem}
        </h2>
        <ul>
          {types.map((t) => (
            <li key={t.code}>
              <PopoverClose asChild>
                <Link href={newHref(t.code)} className={menuItem}>
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

/**
 * The type chips: All, then each of the Module's Types (a new Type shows as a chip with no
 * change here), each with how many items the viewer sees with the other filters on. Under a
 * search the API counts nothing beyond what it shows, so the chips carry no number then.
 */
function TypeChips({
  list,
  query,
  locale,
  labels,
  hrefFor,
  linkAs: Link,
  phone = false,
}: {
  list: SnagListData;
  query: WorkItemQuery;
  locale: Locale;
  labels: SnagListLabels;
  hrefFor: (query: WorkItemQuery) => string;
  linkAs: ElementType;
  /** One row that scrolls sideways, then Need My Action (the kit's "Mine"): the phone's (RP-630). */
  phone?: boolean;
}) {
  const counts = list.typeCounts;
  const countOf = (code: string) => counts?.find((c) => c.code === code)?.count ?? 0;
  const all = counts?.reduce((sum, c) => sum + c.count, 0);
  const { cursor: _cursor, page: _page, ...rest } = query;
  const chip = (key: string, chosen: boolean, type: string[], content: ReactNode, count: number | undefined, next = { ...rest, type }) => (
    <li key={key} className="shrink-0">
      <Link
        href={hrefFor(next)}
        aria-current={chosen ? "true" : undefined}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-control-border bg-surface px-3 text-[13px] font-semibold whitespace-nowrap text-text-secondary hover:bg-hover pointer-coarse:min-h-11",
          "aria-[current=true]:border-primary aria-[current=true]:bg-brand-tint aria-[current=true]:text-brand-fg",
          focusRing,
        )}
      >
        {content}
        {count !== undefined && <span className="font-normal text-muted tabular-nums">{formatNumber(count, locale)}</span>}
      </Link>
    </li>
  );
  return (
    <nav aria-label={labels.types}>
      <ul className={cn("flex items-center gap-2", phone ? "flex-nowrap pb-1" : "flex-wrap")}>
        {chip("all", query.type.length === 0, [], labels.allTypes, all)}
        {list.filters.types.map((t) => {
          const look = lookOf(t.code);
          return chip(
            t.code,
            query.type.length === 1 && query.type[0] === t.code,
            [t.code],
            <>
              <Icon name={look.icon} size={15} className={look.mark} />
              {t.name[locale]}
            </>,
            counts ? countOf(t.code) : undefined,
          );
        })}
        {phone &&
          chip(
            "need-my-action",
            query.needMyAction,
            query.type,
            <>
              {/* eslint-disable-next-line rabaed/no-avoid-terms -- an icon's name */}
              <Icon name="user-check" size={15} />
              {labels.needMyAction}
            </>,
            undefined,
            { ...rest, needMyAction: !query.needMyAction },
          )}
      </ul>
    </nav>
  );
}

/** What it was raised from: the source's number (a link when the viewer sees it, E1) and its outcome, or "by hand". */
function RaisedFrom({ row, locale, labels, itemHref, linkAs: Link }: { row: WorkItemRow; locale: Locale; labels: SnagListLabels; itemHref: (id: string) => string; linkAs: ElementType }) {
  const source = row.raisedFrom;
  if (source === undefined) return dash;
  if (source === null) return <span className="text-[12.5px] text-muted">{labels.raisedManually}</span>;
  const number = <DocNo value={source.documentNumber} locale={locale} className="font-ui text-[12.5px]" />;
  return (
    <span className="inline-flex items-center gap-1.5" title={source.subject}>
      {source.workItemId ? (
        <Link href={itemHref(source.workItemId)} className={cn("text-brand-fg hover:underline", focusRing)}>
          {number}
        </Link>
      ) : (
        <span className="text-text-secondary">{number}</span>
      )}
      {source.outcome && <SourceOutcomeBadge outcome={source.outcome} locale={locale} code={labels.code} />}
    </span>
  );
}

/** A source's outcome as the card badge shows it: "Code B" for a short code, else the outcome's name (RP-94, RP-628). */
export function SourceOutcomeBadge({ outcome, locale, code }: { outcome: NonNullable<RaisedFromSource["outcome"]>; locale: Locale; code: (code: string) => string }) {
  return (
    <HeaderBadge
      badge={{
        kind: "outcome",
        look: outcome.look,
        label: outcome.code.length <= 3 ? code(outcome.code) : outcome.name[locale],
        name: outcome.name[locale],
        code: outcome.code,
      }}
    />
  );
}

/** Who holds it (V14): my own Company's person or Step Pool, another Company by its name only. */
function With({ row, locale, labels, small }: { row: WorkItemRow; locale: Locale; labels: SnagListLabels; small?: boolean }) {
  const owner = ownerOf(row, locale, labels);
  if (!owner) return dash;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {owner.kind === "pool" ? (
        <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted">
          <Icon name={poolIcon} size={13} />
        </span>
      ) : (
        <Avatar name={owner.name} initialsFrom={owner.initialsFrom} kind={owner.kind === "company" ? "company" : "person"} size="sm" solid decorative />
      )}
      <span className={cn("truncate", small && "text-caption text-text-secondary")}>{owner.name}</span>
    </span>
  );
}

/** The first photo the viewer sees, as a small square; an icon until its image arrives (or for a type the browser can't show). */
function Thumbnail({ row, urls, labels }: { row: WorkItemRow; urls: Readonly<Record<string, string>>; labels: SnagListLabels }) {
  if (!row.photo) return dash;
  const url = urls[row.photo.documentId];
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-surface-subtle text-faint ring-1 ring-border-subtle ring-inset">
      {url ? <img src={url} alt={labels.photoOf(row.title)} className="size-full object-cover" /> : <Icon name="photo" size={16} label={labels.photoOf(row.title)} />}
    </span>
  );
}

const cell = "h-12 border-b border-border-subtle bg-surface px-2 align-middle whitespace-nowrap group-hover/row:bg-hover group-data-selected/row:bg-brand-tint";
const head = "sticky top-0 z-[3] h-[42px] border-b border-border-subtle bg-surface-subtle px-2 text-start text-[12.5px] font-semibold whitespace-nowrap text-text-secondary";

/** The List: the page's rows under a folding header per Stage, in the Project's Stage order, each with its count. */
function SnagTable({
  list,
  query,
  locale,
  labels,
  places,
  itemHref,
  hrefFor,
  photoUrls,
  linkAs: Link,
  onQueryChange,
  bulk,
}: {
  list: WorkItemListData;
  query: WorkItemQuery;
  locale: Locale;
  labels: SnagListLabels;
  places: Places;
  itemHref: (id: string) => string;
  hrefFor: (query: WorkItemQuery) => string;
  photoUrls: Readonly<Record<string, string>>;
  linkAs: ElementType;
  onQueryChange: (next: Partial<WorkItemQuery>) => void;
  /** Bulk select: the rows chosen on this page, and what the bar does with them. */
  bulk?: {
    bulk: SnagBulk;
    selected: ReadonlySet<string>;
    onSelect: (ids: ReadonlySet<string>) => void;
    exporting: boolean;
    onExport: (rows: WorkItemRow[]) => void;
    /** A report is being asked for or made. */
    reporting: boolean;
    /** Ask for the PDF of these items. */
    onExportPdf: (ids: string[]) => void;
  };
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const n = (value: number) => formatNumber(value, locale);
  const columns = labels.columns;
  const headers = [columns.documentNumber, columns.subject, columns.type, columns.trade, columns.location, columns.raisedFrom, columns.with, columns.stepAge, columns.photo];
  const colSpan = headers.length + (bulk ? 1 : 0);
  const chosen = bulk ? list.items.filter((r) => bulk.selected.has(r.id)).length : 0;
  const groups = list.stages
    .map((stage) => ({ stage, rows: list.items.filter((r) => r.stage.key === stage.key) }))
    .filter((g) => g.rows.length > 0);
  const pager = <WorkItemPager list={list} query={query} labels={labels} locale={locale} hrefFor={hrefFor} linkAs={Link} onQueryChange={onQueryChange} />;
  return (
    <TableCard footer={pager}>
      {bulk && bulk.selected.size > 0 && (
        <SnagBulkBar
          ids={list.items.filter((r) => bulk.selected.has(r.id)).map((r) => r.id)}
          stages={list.stages}
          locale={locale}
          actions={bulk.bulk.actions}
          exporting={bulk.exporting}
          onExport={() => bulk.onExport(list.items.filter((r) => bulk.selected.has(r.id)))}
          report={bulk.bulk.report}
          reporting={bulk.reporting}
          onExportPdf={() => bulk.onExportPdf(list.items.filter((r) => bulk.selected.has(r.id)).map((r) => r.id))}
          onClear={() => bulk.onSelect(new Set())}
        />
      )}
      <div role="region" aria-label={labels.table} tabIndex={0} className={cn("relative overflow-x-auto", focusRing)}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13.5px] text-text">
          <caption className="sr-only">{labels.table}</caption>
          <thead>
            <tr>
              {bulk && (
                <th scope="col" className={cn(head, "w-11 ps-3 pe-0")}>
                  <Checkbox
                    aria-label={bulk.bulk.actions.labels.selectAll}
                    targetBox
                    className="align-middle"
                    disabled={list.items.length === 0}
                    checked={chosen === 0 ? false : chosen === list.items.length ? true : "indeterminate"}
                    onCheckedChange={() => bulk.onSelect(new Set(chosen === list.items.length ? [] : list.items.map((r) => r.id)))}
                  />
                </th>
              )}
              {headers.map((h) => (
                <th key={h} scope="col" className={head}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ stage, rows }) => {
            const open = !folded.has(stage.key);
            const name = stage.name[locale];
            return (
              <tbody key={stage.key}>
                <tr>
                  <th scope="colgroup" colSpan={colSpan} className="h-11 border-b border-border-subtle bg-surface px-3 text-start font-normal">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? labels.hideGroup(name) : labels.showGroup(name)}
                      onClick={() =>
                        setFolded((f) => {
                          const next = new Set(f);
                          if (open) next.add(stage.key);
                          else next.delete(stage.key);
                          return next;
                        })
                      }
                      className={cn("inline-flex items-center gap-2 rounded-xs", focusRing, touchBox)}
                    >
                      <Icon name={open ? "chevron-down" : "chevron-right"} size={16} className="text-muted" />
                      <StagePill stage={stageColour(stage)} label={name} locale={locale} />
                      <span className="text-caption text-muted">{labels.items(n(stage.count), stage.count)}</span>
                    </button>
                  </th>
                </tr>
                {open &&
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      data-selected={bulk?.selected.has(row.id) || undefined}
                      className="group/row cursor-pointer"
                      onClick={(event) => {
                        // eslint-disable-next-line rabaed/no-avoid-terms -- CSS element names: a click on a control in the row is its own
                        if ((event.target as Element).closest("a, button, input, label")) return;
                        event.currentTarget.querySelector<HTMLAnchorElement>("a[data-item-link]")?.click();
                      }}
                    >
                      {bulk && (
                        <td className={cn(cell, "w-11 ps-4 pe-0")}>
                          <Checkbox
                            aria-label={bulk.bulk.actions.labels.selectRow(row.title)}
                            className="size-4 align-middle"
                            checked={bulk.selected.has(row.id)}
                            onCheckedChange={(on) => {
                              const next = new Set(bulk.selected);
                              if (on === true) next.add(row.id);
                              else next.delete(row.id);
                              bulk.onSelect(next);
                            }}
                          />
                        </td>
                      )}
                      <td className={cell}>
                        {row.documentNumber ? (
                          <DocNo value={row.documentNumber} locale={locale} className="font-ui text-[12.5px] font-semibold text-muted" />
                        ) : (
                          <span className="text-muted">{labels.noNumber}</span>
                        )}
                      </td>
                      <td className={cell}>
                        <Link
                          href={itemHref(row.id)}
                          data-item-link=""
                          dir="auto"
                          title={row.title}
                          className={cn("block max-w-[190px] truncate font-semibold text-text hover:text-brand-fg", focusRing, touchBox)}
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className={cell}>
                        <SnagTypeChip code={row.type.code} name={row.type.name[locale]} />
                      </td>
                      <td className={cell}>
                        <span className={cn("inline-flex h-[22px] items-center rounded-[6px] px-1.5 text-caption font-semibold", tradeChipClass(row.trade.code))}>{row.trade.name[locale]}</span>
                      </td>
                      <td className={cn(cell, "max-w-[140px] min-w-[110px] text-[12.5px] leading-tight whitespace-normal text-text-secondary")}>{placeText(row, places, locale) ?? dash}</td>
                      <td className={cell}>
                        <RaisedFrom row={row} locale={locale} labels={labels} itemHref={itemHref} linkAs={Link} />
                      </td>
                      <td className={cn(cell, "max-w-[150px]")}>
                        <With row={row} locale={locale} labels={labels} />
                      </td>
                      <td className={cell}>{isOpenStageCategory(row.stage.category) && row.stepAgeWeeks !== null ? <AgeDots weeks={row.stepAgeWeeks} locale={locale} /> : dash}</td>
                      <td className={cn(cell, "py-1")}>
                        <Thumbnail row={row} urls={photoUrls} labels={labels} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </TableCard>
  );
}

/** The Kanban: a column per Stage (Drafts left out, as on every board), each with its count and its cards. */
function SnagBoard({
  board,
  locale,
  labels,
  places,
  itemHref,
  photoUrls,
  linkAs: Link,
}: {
  board: WorkItemBoardData;
  locale: Locale;
  labels: SnagListLabels;
  places: Places;
  itemHref: (id: string) => string;
  photoUrls: Readonly<Record<string, string>>;
  linkAs: ElementType;
}) {
  const n = (value: number) => formatNumber(value, locale);
  const columns = new Map(board.columns.map((c) => [c.stageKey, c]));
  return (
    <section aria-label={labels.board} tabIndex={0} className={cn("flex min-w-0 gap-3 overflow-x-auto pb-2", focusRing)}>
      {board.stages
        .filter((s) => s.category !== "draft")
        .map((stage) => {
          const cards = (columns.get(stage.key)?.lanes ?? []).flatMap((l) => l.cards);
          return (
            <section key={stage.key} aria-label={stage.name[locale]} className="flex w-[272px] shrink-0 flex-col rounded-md bg-surface-subtle">
              <h2 className="flex h-11 items-center gap-2 px-3 text-[13.5px] font-semibold text-text">
                <StageDot stage={stageColour(stage)} />
                {stage.name[locale]}
                <span className="ms-auto rounded-full bg-surface px-2 text-caption font-semibold text-muted tabular-nums">{n(stage.count)}</span>
              </h2>
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {cards.length === 0 ? (
                  <li className="rounded-sm border border-dashed border-border px-3 py-6 text-center text-caption text-faint">{labels.noItems}</li>
                ) : (
                  cards.map((card) => <SnagCard key={card.id} card={card} locale={locale} labels={labels} places={places} itemHref={itemHref} photoUrls={photoUrls} linkAs={Link} />)
                )}
              </ul>
            </section>
          );
        })}
    </section>
  );
}

function SnagCard({
  card,
  locale,
  labels,
  places,
  itemHref,
  photoUrls,
  linkAs: Link,
}: {
  card: WorkItemRow;
  locale: Locale;
  labels: SnagListLabels;
  places: Places;
  itemHref: (id: string) => string;
  photoUrls: Readonly<Record<string, string>>;
  linkAs: ElementType;
}) {
  const look = lookOf(card.type.code);
  const place = placeText(card, places, locale);
  return (
    <li className="relative flex flex-col gap-2 rounded-sm border border-border-subtle bg-surface p-3 shadow-xs hover:border-border-strong">
      <div className="flex items-center gap-2">
        <Icon name={look.icon} size={16} className={look.mark} label={card.type.name[locale]} />
        {card.documentNumber ? (
          <DocNo value={card.documentNumber} locale={locale} className="font-ui text-caption font-semibold text-muted" />
        ) : (
          <span className="text-caption text-muted">{labels.noNumber}</span>
        )}
        {card.photo && (
          <span className="ms-auto">
            <Thumbnail row={card} urls={photoUrls} labels={labels} />
          </span>
        )}
      </div>
      <Link href={itemHref(card.id)} dir="auto" className={cn("line-clamp-2 font-semibold text-text after:absolute after:inset-0 hover:text-brand-fg", focusRing)}>
        {card.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-caption text-text-secondary">
        {place && (
          <span className="inline-flex items-center gap-1">
            <Icon name="map-pin" size={13} className="text-muted" />
            {place}
          </span>
        )}
        <span className={cn("inline-flex h-5 items-center rounded-[6px] px-1.5 text-notes font-semibold", tradeChipClass(card.trade.code))}>{card.trade.name[locale]}</span>
      </div>
      <div className="flex items-center gap-2">
        <With row={card} locale={locale} labels={labels} small />
        <span className="ms-auto shrink-0">{isOpenStageCategory(card.stage.category) && card.stepAgeWeeks !== null && <AgeDots weeks={card.stepAgeWeeks} locale={locale} />}</span>
      </div>
    </li>
  );
}
