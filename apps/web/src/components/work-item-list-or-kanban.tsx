"use client";

import {
  watchOutcomeNames,
  workItemSearchParams,
  type BoardCardLayout,
  type BoardCardLayoutChange,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemList as WorkItemListData,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import {
  BoardLayoutMenu,
  WorkItemBoard,
  WorkItemList,
  WorkItemViewSwitch,
  type BoardLayoutMenuLabels,
  type WorkItemBoardLabels,
  type WorkItemFilterHints,
  type WorkItemListLabels,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
// The hrefs here already carry their locale (the browser's own path, getPathname): next/link keeps navigation
// client-side without adding the locale again.
import NextLink from "next/link";
import { WorkItemBoardMove } from "@/components/work-item-board-move";
import { getPathname } from "@/i18n/navigation";
import { chainLabels } from "@/lib/chain-labels";
import { workItemListSearchParams } from "@/lib/page-trail";

/** The List's and the Kanban's words, from the app's messages. */
function useViewLabels(tableLabel: string): { list: WorkItemListLabels; board: WorkItemBoardLabels; layout: BoardLayoutMenuLabels } {
  const t = useTranslations("workItemViews");
  const l = (key: string) => t(`list.${key}`);
  const locale = useLocale() as Locale;
  const shared = {
    noNumber: l("noNumber"),
    revisionNoNumber: (revision: string) => t("list.revisionNoNumber", { revision }),
    unclaimed: l("unclaimed"),
    // Cancelled is named once, with the notifications (watchOutcomeNames); every other outcome by its Type's set (RP-429).
    cancelled: watchOutcomeNames.cancelled[locale],
  };
  const keys = [
    "toolbar", "all", "type", "stage", "with", "withMe", "anyUnclaimed", "trade", "location", "outcome", "stepAge",
    "submissionDate", "creationDate", "submittedFrom", "submittedTo", "allRevisions", "needMyAction", "clear", "stageCounts",
    "documentNumber", "subject", "empty", "search", "searchPlaceholder", "searchHelp", "noResults", "filters", "clearAll", "done",
    "close", "pages", "firstPage", "previousPage", "nextPage", "documentType", "owner", "role", "createdDate", "clearField",
    "searchValues", "noMatches", "searchPlaceholderBoard", "revisions",
  ] as const;
  const layoutKeys = ["title", "boardSettings", "fixedParts", "alwaysShown", "contractorName", "location", "creationDate", "preview"] as const;
  return {
    list: {
      ...(Object.fromEntries(keys.map((key) => [key, l(key)])) as Record<(typeof keys)[number], string>),
      ...shared,
      table: tableLabel,
      weeksOrMore: (weeks, count) => t("list.weeksOrMore", { weeks, count }),
      filtersApplied: (n, count) => t("list.filtersApplied", { n, count }),
      page: (page) => t("list.page", { page }),
      pageOf: (page, pages) => t("list.pageOf", { page, pages }),
      items: (n, count) => t("list.items", { n, count }),
      dashboardFigure: l("dashboardFigure"),
      withinDays: (days, count) => t("list.withinDays", { days, count }),
      level: (n) => t("list.level", { n }),
      ...chainLabels(t),
    },
    board: {
      ...shared,
      board: t("board.board"),
      noItems: t("board.noItems"),
      closedSince: (days) => t("board.closedSince", { days }),
      total: (count) => t("board.total", { count }),
      showAll: t("board.showAll"),
      showAllIn: (stage) => t("board.showAllIn", { stage }),
      move: t("board.move"),
      moveItem: (subject) => t("board.moveItem", { subject }),
      moveTo: (stage) => t("board.moveTo", { stage }),
      dragging: t("board.dragging"),
      mixed: t("board.mixed"),
      revision: (n) => t("board.revision", { n }),
      code: (code) => t("board.code", { code }),
      createdOn: (date) => t("board.createdOn", { date }),
      submittedOn: (date) => t("board.submittedOn", { date }),
    },
    layout: Object.fromEntries(layoutKeys.map((key) => [key, t(`layout.${key}`)])) as BoardLayoutMenuLabels,
  };
}

/**
 * A Module tab's items as the List or the Kanban, with the toolbar and the
 * View switch: every filter, sort, page and the View are the page's own URL,
 * so a view can be bookmarked or shared and the back button undoes a filter.
 * The List's URL also keeps the pages before the one it shows (`page-trail`).
 */
export function WorkItemListOrKanban(
  props: {
    query: WorkItemQuery;
    locale: Locale;
    tableLabel: string;
    /** The toolbar's primary action, e.g. "New Material Submittal". */
    action?: ReactNode;
    /** The Project and Module of the tab: the board's Card view layout and collapsed groups are kept per board. */
    projectId: string;
    module: string;
    /** The filter fields' names in the other language. */
    hints?: WorkItemFilterHints;
  } & ({ view: "list"; list: WorkItemListData; pageTrail?: readonly string[] } | { view: "kanban"; board: WorkItemBoardData }),
) {
  const { query, locale, view, action, projectId, module, hints } = props;
  const t = useTranslations("workItemViews");
  const labels = useViewLabels(props.tableLabel);
  const router = useRouter();
  const [moving, setMoving] = useState<{ card: WorkItemRow; move: WorkItemMove } | null>(null);
  // The viewer's own Card view layout: shown at once, kept for them by the API (RP-410).
  const [layout, setLayout] = useState<BoardCardLayout | null>(props.view === "kanban" ? props.board.layout : null);
  const changeLayout = (change: BoardCardLayoutChange) => {
    setLayout((current) => (current ? { ...current, ...change } : current));
    void fetch(`/api/v1/projects/${projectId}/modules/${module}/work-items/kanban/layout`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
  };
  // The path with its locale, as the browser shows it.
  const pathname = usePathname();
  const hrefIn = (v: WorkItemView, q: WorkItemQuery, trail?: readonly string[]) => {
    // The tab's path names the Module, so the query string doesn't. The Kanban has no pages.
    const params = v === "list" ? workItemListSearchParams({ ...q, module: undefined }, trail) : workItemSearchParams({ ...q, module: undefined });
    if (v === "kanban") params.set("view", "kanban");
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const hrefFor = (q: WorkItemQuery, trail?: readonly string[]) => hrefIn(view, q, trail);
  const itemHref = (id: string) => getPathname({ href: `/work-items/${id}`, locale });
  return (
    <WorkItemList
      list={props.view === "list" ? props.list : { ...props.board, items: [], nextCursor: null }}
      query={query}
      locale={locale}
      labels={labels.list}
      hrefFor={hrefFor}
      pageTrail={props.view === "list" ? props.pageTrail : undefined}
      itemHref={itemHref}
      linkAs={NextLink}
      onQueryChange={(q) => router.push(hrefFor(q))}
      action={action}
      hints={hints}
      viewSwitch={
        <>
          {props.view === "kanban" && layout && (
            <BoardLayoutMenu
              layout={layout}
              onChange={changeLayout}
              labels={labels.layout}
              board={props.board}
              boardLabels={labels.board}
              locale={locale}
            />
          )}
          {/* The Kanban has no pages: switching keeps the filters, from the first page. */}
          <WorkItemViewSwitch
            view={view}
            labels={{ view: t("viewSwitch.view"), list: t("viewSwitch.list"), kanban: t("viewSwitch.kanban") }}
            hrefFor={(v) => hrefIn(v, { ...query, cursor: undefined })}
            linkAs={NextLink}
          />
        </>
      }
      board={
        props.view === "kanban" ? (
          <>
            <WorkItemBoard
              board={props.board}
              query={query}
              locale={locale}
              labels={labels.board}
              layout={layout ?? props.board.layout}
              storageKey={`${projectId}:${module}`}
              // The canvas reaches the page's edges (PageContent's padding), as the anatomy draws it.
              className="-mx-4 px-4 sm:-mx-7 sm:px-7"
              listHrefFor={(q) => hrefIn("list", q)}
              itemHref={itemHref}
              linkAs={NextLink}
              onMove={(card, move) => setMoving({ card, move })}
            />
            {/* A drop, or the card's Move menu, opens the Transition's Action Form. */}
            {moving && <WorkItemBoardMove key={`${moving.card.id}:${moving.move.transition}`} {...moving} locale={locale} onClose={() => setMoving(null)} />}
          </>
        ) : undefined
      }
    />
  );
}
