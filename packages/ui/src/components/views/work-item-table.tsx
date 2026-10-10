"use client";

import {
  cardNumber,
  formatDate,
  formatNumber,
  isOpenStageCategory,
  sortDirectionOf,
  workItemSortOrders,
  type BilingualText,
  type ListColumnKey,
  type ListColumnLayout,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { HeaderBadge, poolIcon, tradeChipClass } from "./kanban-card.tsx";
import { badgeOf, ownerOf, placesOf } from "./work-item-board.tsx";

// The List's table (RP-409, the owner's design): a header row of sortable
// columns in the Member's own order, 48px rows, the Document Number pinned at
// the reading start while the table scrolls sideways in its own region.

/** The table's words, from the app's messages. */
export type WorkItemTableLabels = {
  /** The table's name: the Module's, e.g. "Submittals". */
  table: string;
  /** Each column's header; the Zone, Building and Floor give way to the Location tree's own level names. */
  columns: Record<ListColumnKey, string>;
  /** A column's sort button, e.g. "Sort by Title". */
  sortBy: (column: string) => string;
  noNumber: string;
  revisionNoNumber: (revision: string) => string;
  /** After a Step's name, when nobody in the viewer's Company has claimed it. */
  unclaimed: string;
  /** The outcome of a cancelled item. */
  cancelled: string;
  /** A letter outcome's pill, e.g. "Code A". */
  code: (code: string) => string;
  /** The Revision chip, e.g. "R2". */
  revision: (n: string) => string;
  /** The one row of an empty table. */
  empty: string;
};

export type WorkItemTableProps = {
  rows: WorkItemRow[];
  /** What the List read around its rows: the Types' outcomes and the Location tree. */
  filters: Pick<WorkItemListData["filters"], "outcomes" | "locations">;
  /** The Member's columns, in order; only the shown ones are drawn. */
  columns: ListColumnLayout;
  /** The query's sort and its direction. */
  query: Pick<WorkItemQuery, "sort" | "dir">;
  locale: Locale;
  labels: WorkItemTableLabels;
  /** Sorts by a column: its own order first, then the other way round. */
  onSort: (sort: Pick<WorkItemQuery, "sort" | "dir">) => void;
  itemHref: (id: string) => string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** In the last header cell, pinned at the reading end: the column settings. */
  settings?: ReactNode;
  className?: string;
};

/** Each column's least width, as the design draws it (px). */
const widths: Record<ListColumnKey, string> = {
  documentNumber: "min-w-[150px]",
  subject: "min-w-[260px]",
  revision: "min-w-[70px]",
  trade: "min-w-[190px]",
  type: "min-w-[80px]",
  stage: "min-w-[170px]",
  outcome: "min-w-[100px]",
  locationLevel1: "min-w-[100px]",
  locationLevel2: "min-w-[110px]",
  locationLevel3: "min-w-[90px]",
  owner: "min-w-[200px]",
  contractor: "min-w-[220px]",
  created: "min-w-[120px]",
  stepAge: "min-w-[110px]",
};

const levelOf: Partial<Record<ListColumnKey, number>> = { locationLevel1: 1, locationLevel2: 2, locationLevel3: 3 };

/** A column's header: the Location tree's own name for its level when it has one (Zone, Building, Floor). */
export function columnHeader(key: ListColumnKey, labels: Pick<WorkItemTableLabels, "columns">, locations: WorkItemTableProps["filters"]["locations"], locale: Locale) {
  const depth = levelOf[key];
  const named = depth === undefined ? undefined : locations.find((l) => l.depth === depth && l.levelName !== null)?.levelName;
  return named ? named[locale] : labels.columns[key];
}

const cell = "h-12 border-b border-border-subtle bg-surface px-3 align-middle whitespace-nowrap group-hover/row:bg-hover group-data-selected/row:bg-brand-tint";
const head =
  "sticky top-0 z-[3] h-[42px] border-b border-border-subtle bg-surface-subtle px-3 text-start text-[12.5px] font-semibold whitespace-nowrap text-text-secondary";
/** The pinned first column (the Document Number), above the cells that scroll under it. */
const pinnedStart = "sticky start-0 z-[2]";
const dash = <span className="text-faint">—</span>;

export function WorkItemTable({ rows, filters, columns, query, locale, labels, onSort, itemHref, linkAs: Link = "a", settings, className }: WorkItemTableProps) {
  const shown = columns.filter((c) => c.shown).map((c) => c.key);
  const places = placesOf(filters.locations);
  const direction = sortDirectionOf(query);
  const colSpan = shown.length + (settings ? 1 : 0);
  return (
    <table className={cn("w-max min-w-full border-separate border-spacing-0 text-[13.5px] text-text", className)}>
      <caption className="sr-only">{labels.table}</caption>
      <thead>
        <tr>
          {shown.map((key, i) => {
            const header = columnHeader(key, labels, filters.locations, locale);
            const sorted = query.sort === key;
            return (
              <th
                key={key}
                scope="col"
                aria-sort={sorted ? (direction === "asc" ? "ascending" : "descending") : "none"}
                className={cn(head, widths[key], i === 0 && cn(pinnedStart, "z-[4]"))}
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="grid-dots" size={13} className="shrink-0 text-faint opacity-70" />
                  <span>{header}</span>
                  <button
                    type="button"
                    aria-label={labels.sortBy(header)}
                    title={labels.sortBy(header)}
                    onClick={() =>
                      onSort({ sort: key, dir: sorted ? (direction === "asc" ? "desc" : "asc") : workItemSortOrders[key] })
                    }
                    className={cn(
                      "ms-auto inline-flex shrink-0 rounded-xs p-0.5 text-faint hover:bg-hover hover:text-text",
                      sorted && "text-brand-fg hover:text-brand-fg",
                      focusRing,
                      touchBox,
                    )}
                  >
                    <Icon name={!sorted ? "arrows-sort" : direction === "asc" ? "sort-ascending" : "sort-descending"} size={15} />
                  </button>
                </span>
              </th>
            );
          })}
          {settings && (
            <th scope="col" className={cn(head, "sticky end-0 z-[4] w-[52px] border-s px-2 text-center")}>
              {settings}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={colSpan} className="h-32 text-center text-muted">
              {labels.empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={row.id}
              className="group/row cursor-pointer"
              // The whole row opens the item; the Subject is its link, for the keyboard and screen readers.
              onClick={(event) => {
                // eslint-disable-next-line rabaed/no-avoid-terms -- CSS element names: a click on a control in the row is its own
                if ((event.target as Element).closest("a, button, input, label")) return;
                event.currentTarget.querySelector<HTMLAnchorElement>("a[data-item-link]")?.click();
              }}
            >
              {shown.map((key, i) => (
                <td key={key} className={cn(cell, i === 0 && pinnedStart)}>
                  <Cell column={key} row={row} locale={locale} labels={labels} filters={filters} places={places} itemHref={itemHref} linkAs={Link} />
                </td>
              ))}
              {settings && <td className={cn(cell, "sticky end-0 z-[2] border-s px-2")} />}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

type CellProps = {
  column: ListColumnKey;
  row: WorkItemRow;
  locale: Locale;
  labels: WorkItemTableLabels;
  filters: WorkItemTableProps["filters"];
  places: Map<string, { depth: number; name: BilingualText }[]>;
  itemHref: (id: string) => string;
  linkAs: ElementType;
};

/** One cell, as the viewer may read it: the owner per V14, the Creation Date only to the raiser's Participant. */
function Cell({ column, row, locale, labels, filters, places, itemHref, linkAs: Link }: CellProps): ReactNode {
  const n = (value: number) => formatNumber(value, locale);
  switch (column) {
    case "documentNumber": {
      // The Rev column carries the Revision, so the number leaves out its " Rev n".
      const number = cardNumber(row.documentNumber, row.revisionNo);
      return number ? (
        <DocNo value={number} locale={locale} className="font-ui font-normal text-muted tabular-nums" />
      ) : (
        <span className="text-muted">{row.revisionNo > 0 ? labels.revisionNoNumber(n(row.revisionNo)) : labels.noNumber}</span>
      );
    }
    case "subject":
      return (
        <Link
          href={itemHref(row.id)}
          data-item-link=""
          dir="auto"
          title={row.title}
          className={cn("block max-w-[260px] truncate font-semibold text-text hover:text-brand-fg", focusRing, touchBox)}
        >
          {row.title}
        </Link>
      );
    case "revision":
      return row.revisionNo === 0 ? (
        <span translate="no" className="font-ui text-muted tabular-nums">
          {labels.revision(n(0))}
        </span>
      ) : (
        <span translate="no" className="inline-flex h-6 items-center rounded-[7px] bg-revision-bg px-2 font-ui text-caption font-bold text-revision-fg">
          {labels.revision(n(row.revisionNo))}
        </span>
      );
    case "trade":
      return (
        <span className={cn("inline-flex h-6 items-center rounded-[7px] px-2 text-caption font-semibold", tradeChipClass(row.trade.code))}>
          {row.trade.name[locale]} (<bdi translate="no">{row.trade.code}</bdi>)
        </span>
      );
    case "type":
      return (
        <span
          translate="no"
          className="inline-flex h-5 items-center rounded-xs px-1.5 font-ui text-notes font-bold tracking-wide text-text-secondary ring-1 ring-border-strong ring-inset"
        >
          {row.type.code}
        </span>
      );
    case "stage":
      return <StagePill stage={stageColour(row.stage)} label={row.stage.name[locale]} locale={locale} className="rounded-[7px]" />;
    case "outcome": {
      const badge = row.outcome === null ? undefined : badgeOf(row, locale, labels, filters.outcomes);
      return badge ? <HeaderBadge badge={badge} /> : dash;
    }
    case "locationLevel1":
    case "locationLevel2":
    case "locationLevel3": {
      const depth = levelOf[column]!;
      const place = row.location === null ? undefined : (places.get(row.location.id) ?? [{ depth: 1, name: row.location.name }]).find((p) => p.depth === depth);
      return place ? <span className="text-text-secondary">{place.name[locale]}</span> : dash;
    }
    case "owner": {
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
          <span className="truncate">{owner.name}</span>
        </span>
      );
    }
    case "contractor":
      return row.raiserCompanyName ? <span className="text-text-secondary">{row.raiserCompanyName[locale]}</span> : dash;
    case "created": {
      // The Creation Date on my own Company's items (the API gives it to the raiser's Participant only), else the Submission Date.
      const iso = row.creationDate ?? row.submissionDate;
      return iso === null ? dash : <span className="font-ui text-muted tabular-nums">{listDate(iso, locale)}</span>;
    }
    case "stepAge":
      // A closed item doesn't age.
      return isOpenStageCategory(row.stage.category) && row.stepAgeWeeks !== null ? <AgeDots weeks={row.stepAgeWeeks} locale={locale} /> : dash;
  }
}

/** A date as the List writes it: "01 Aug 2026", Latin digits in both languages. */
export const listDate = (iso: string, locale: Locale) => formatDate(new Date(iso), locale, { day: "2-digit", month: "short", year: "numeric" });
