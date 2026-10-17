"use client";

import {
  workItemSearchParams,
  type Locale,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import { SnagList, WorkItemViewSwitch, type SnagListLabels, type SnagNewType } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
// The hrefs here already carry their locale (the browser's own path, getPathname).
import NextLink from "next/link";
import { getPathname } from "@/i18n/navigation";
import { listSearchParams, snagListSort } from "@/lib/list-url";

/** Browsers show these image types; a HEIC photo shows an icon. */
const shownImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The thumbnails' short-lived image URLs, by Document id: the same download URLs the API
 * signs for opening a Document, asked only for the photos the rows carry (those the viewer sees).
 */
function usePhotoUrls(rows: readonly WorkItemRow[]): Readonly<Record<string, string>> {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const wanted = rows.flatMap((r) => (r.photo && shownImageTypes.has(r.photo.contentType) ? [`${r.id}/${r.photo.documentId}`] : []));
  const missing = wanted.filter((key) => !(key.split("/")[1]! in urls)).join(",");
  useEffect(() => {
    if (!missing) return;
    let current = true;
    void Promise.all(
      missing.split(",").map(async (key) => {
        const [itemId, documentId] = key.split("/") as [string, string];
        const res = await fetch(`/api/v1/work-items/${itemId}/documents/${documentId}/download`).catch(() => null);
        return res?.ok ? ([documentId, ((await res.json()) as { url: string }).url] as const) : null;
      }),
    ).then((found) => {
      if (current) setUrls((known) => ({ ...known, ...Object.fromEntries(found.filter((f) => f !== null)) }));
    });
    return () => {
      current = false;
    };
  }, [missing]);
  return urls;
}

/** The views' words, from the app's messages. */
function useSnagLabels(tableLabel: string): SnagListLabels {
  const t = useTranslations("snagList");
  const l = useTranslations("workItemViews.list");
  const b = useTranslations("workItemViews.board");
  return {
    toolbar: l("toolbar"),
    search: l("search"),
    searchPlaceholder: t("searchPlaceholder"),
    searchHelp: l("searchHelp"),
    filters: l("filters"),
    clearAll: l("clearAll"),
    done: l("done"),
    close: l("close"),
    filtersApplied: (n, count) => l("filtersApplied", { n, count }),
    clear: l("clear"),
    clearField: l("clearField"),
    searchValues: l("searchValues"),
    noMatches: l("noMatches"),
    needMyAction: l("needMyAction"),
    newItem: t("newItem"),
    newOfType: (type) => t("newOfType", { type }),
    types: t("types"),
    allTypes: t("allTypes"),
    stage: l("stage"),
    trade: l("trade"),
    company: t("company"),
    raisedFrom: t("raisedFrom"),
    level: (n) => l("level", { n }),
    raisedManually: t("raisedManually"),
    table: tableLabel,
    columns: {
      documentNumber: l("documentNumber"),
      subject: l("subject"),
      type: l("type"),
      trade: l("trade"),
      location: l("location"),
      raisedFrom: t("raisedFrom"),
      with: l("with"),
      stepAge: l("stepAge"),
      photo: t("photo"),
    },
    items: (n, count) => l("items", { n, count }),
    hideGroup: (stage) => t("hideGroup", { stage }),
    showGroup: (stage) => t("showGroup", { stage }),
    noNumber: l("noNumber"),
    notPickedUp: l("notPickedUp"),
    code: (code) => t("code", { code }),
    photoOf: (subject) => t("photoOf", { subject }),
    board: b("board"),
    noItems: t("noItems"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    noMatchTitle: t("noMatchTitle"),
    noSearchMatchTitle: t("noSearchMatchTitle"),
    clearFilters: t("clearFilters"),
    pages: l("pages"),
    rowsPerPage: l("rowsPerPage"),
    firstPage: l("firstPage"),
    previousPage: l("previousPage"),
    nextPage: l("nextPage"),
    lastPage: l("lastPage"),
    page: (page) => l("page", { page }),
    pageOf: (page, pages) => l("pageOf", { page, pages }),
  };
}

/**
 * The Snag List tab (RP-94): its own List grouped by Stage and its Kanban, with the type
 * chips and its filters. Every filter, page and the View are the page's URL, as on every
 * Module tab, so a view can be shared and the back button undoes a filter.
 */
export function SnagListView(
  props: {
    query: WorkItemQuery;
    locale: Locale;
    tableLabel: string;
    projectId: string;
    /** The Snag List Types the viewer may raise. */
    newTypes: SnagNewType[];
  } & ({ view: "list"; list: WorkItemListData } | { view: "kanban"; board: WorkItemBoardData }),
) {
  const { query, locale, view, projectId, newTypes } = props;
  const t = useTranslations("workItemViews");
  const labels = useSnagLabels(props.tableLabel);
  const router = useRouter();
  const pathname = usePathname();
  const hrefIn = (v: WorkItemView, q: WorkItemQuery) => {
    // The tab's path names the Module. The List's own sort (by Stage) stays out of the URL; the Kanban has no pages.
    const params =
      v === "list"
        ? listSearchParams({ ...q, module: undefined })
        : workItemSearchParams({ ...q, module: undefined, cursor: undefined, page: undefined, pageSize: undefined, lang: undefined, sort: undefined });
    if (v === "list" && q.sort === snagListSort) params.delete("sort");
    if (v === "kanban") params.set("view", "kanban");
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const rows = props.view === "list" ? props.list.items : props.board.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
  const photoUrls = usePhotoUrls(rows);
  return (
    <SnagList
      data={props.view === "list" ? { view: "list", list: props.list } : { view: "kanban", board: props.board }}
      query={query}
      locale={locale}
      labels={labels}
      hrefFor={(q) => hrefIn(view, q)}
      itemHref={(id) => getPathname({ href: `/work-items/${id}`, locale })}
      onQueryChange={(q) => router.push(hrefIn(view, q))}
      newTypes={newTypes}
      newHref={(code) => getPathname({ href: `/projects/${projectId}/work-items/new?module=snag_list&type=${encodeURIComponent(code)}`, locale })}
      photoUrls={photoUrls}
      linkAs={NextLink}
      viewSwitch={
        <WorkItemViewSwitch
          view={view}
          labels={{ view: t("viewSwitch.view"), list: t("viewSwitch.list"), kanban: t("viewSwitch.kanban") }}
          // The List opens at its first page, by Stage; the Kanban takes the filters.
          hrefFor={(v) => hrefIn(v, { ...query, cursor: undefined, page: undefined, sort: v === "list" ? snagListSort : query.sort })}
          linkAs={NextLink}
        />
      }
    />
  );
}
