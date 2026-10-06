"use client";

import {
  workItemOutcomes,
  workItemSearchParams,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemList as WorkItemListData,
  type WorkItemMove,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { WorkItemBoard, WorkItemList, WorkItemViewSwitch, type WorkItemBoardLabels, type WorkItemListLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
// The hrefs here already carry their locale (the browser's own path, getPathname): next/link keeps navigation
// client-side without adding the locale again.
import NextLink from "next/link";
import { WorkItemBoardMove } from "@/components/work-item-board-move";
import { getPathname } from "@/i18n/navigation";

/** The List's and the Kanban's words, from the app's messages. */
function useViewLabels(tableLabel: string): { list: WorkItemListLabels; board: WorkItemBoardLabels } {
  const t = useTranslations("workItemViews");
  const l = (key: string) => t(`list.${key}`);
  const outcomes = Object.fromEntries(workItemOutcomes.map((o) => [o, t(`outcomes.${o}`)])) as Record<WorkItemOutcome, string>;
  const shared = {
    noNumber: l("noNumber"),
    revisionNoNumber: (revision: string) => t("list.revisionNoNumber", { revision }),
    unclaimed: l("unclaimed"),
    outcomes,
  };
  const keys = [
    "toolbar", "all", "type", "stage", "with", "withMe", "anyUnclaimed", "trade", "location", "outcome", "stepAge", "sort",
    "sortStepAge", "sortDocumentNumber", "sortSubmissionDate", "submissionDate", "creationDate", "submittedFrom", "submittedTo",
    "allRevisions", "needMyAction", "clear", "stageCounts", "documentNumber", "subject", "empty", "search", "searchHelp",
    "noResults", "pages", "firstPage", "nextPage",
  ] as const;
  return {
    list: {
      ...(Object.fromEntries(keys.map((key) => [key, l(key)])) as Record<(typeof keys)[number], string>),
      ...shared,
      table: tableLabel,
      weeksOrMore: (weeks) => t("list.weeksOrMore", { weeks }),
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
    },
  };
}

/**
 * A Module tab's items as the List or the Kanban, with the toolbar and the
 * View switch: every filter, sort, page and the View are the page's own URL,
 * so a view can be bookmarked or shared and the back button undoes a filter.
 */
export function WorkItemListOrKanban(
  props: { query: WorkItemQuery; locale: Locale; tableLabel: string } & (
    | { view: "list"; list: WorkItemListData }
    | { view: "kanban"; board: WorkItemBoardData }
  ),
) {
  const { query, locale, view } = props;
  const t = useTranslations("workItemViews");
  const labels = useViewLabels(props.tableLabel);
  const router = useRouter();
  const [moving, setMoving] = useState<{ card: WorkItemRow; move: WorkItemMove } | null>(null);
  // The path with its locale, as the browser shows it.
  const pathname = usePathname();
  const hrefIn = (v: WorkItemView, q: WorkItemQuery) => {
    const params = workItemSearchParams(q);
    if (v === "kanban") params.set("view", "kanban");
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const hrefFor = (q: WorkItemQuery) => hrefIn(view, q);
  const itemHref = (id: string) => getPathname({ href: `/work-items/${id}`, locale });
  return (
    <div className="space-y-4">
      {/* The Kanban has no pages: switching keeps the filters, from the first page. */}
      <WorkItemViewSwitch
        view={view}
        labels={{ view: t("viewSwitch.view"), list: t("viewSwitch.list"), kanban: t("viewSwitch.kanban") }}
        hrefFor={(v) => hrefIn(v, { ...query, cursor: undefined })}
        linkAs={NextLink}
      />
      <WorkItemList
        list={props.view === "list" ? props.list : { ...props.board, items: [], nextCursor: null }}
        query={query}
        locale={locale}
        labels={labels.list}
        hrefFor={hrefFor}
        itemHref={itemHref}
        onQueryChange={(q) => router.push(hrefFor(q))}
        board={
          props.view === "kanban" ? (
            <>
              <WorkItemBoard
                board={props.board}
                query={query}
                locale={locale}
                labels={labels.board}
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
    </div>
  );
}
