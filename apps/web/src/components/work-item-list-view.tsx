"use client";

import {
  workItemSearchParams,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemList as WorkItemListData,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { WorkItemBoard, WorkItemList, WorkItemViewSwitch } from "@rabaed/ui";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { WorkItemBoardMove } from "@/components/work-item-board-move";
import { getPathname } from "@/i18n/navigation";

/**
 * The List or the Kanban with its toolbar: every filter, sort, page and the
 * View are the page's own URL, so a view can be bookmarked or shared and the
 * back button undoes a filter.
 */
export function WorkItemListView(
  props: { query: WorkItemQuery; locale: Locale } & ({ view: "list"; list: WorkItemListData } | { view: "kanban"; board: WorkItemBoardData }),
) {
  const { query, locale, view } = props;
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
      <WorkItemViewSwitch view={view} locale={locale} hrefFor={(v) => hrefIn(v, { ...query, cursor: undefined })} />
      <WorkItemList
        list={props.view === "list" ? props.list : { ...props.board, items: [], nextCursor: null }}
        query={query}
        locale={locale}
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
                listHrefFor={(q) => hrefIn("list", q)}
                itemHref={itemHref}
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
