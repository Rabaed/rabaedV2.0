"use client";

import {
  workItemSearchParams,
  type Locale,
  type SnagBulkCandidates,
  type SnagBulkResult,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemExport,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemView,
} from "@rabaed/domain";
import { SnagList, WorkItemViewSwitch, type SnagBulk, type SnagBulkLabels, type SnagListLabels, type SnagNewType } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
// The hrefs here already carry their locale (the browser's own path, getPathname).
import NextLink from "next/link";
import { getPathname } from "@/i18n/navigation";
import { usePhotoUrls } from "@/components/use-documents";
import { listSearchParams, snagListSort } from "@/lib/list-url";

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

/** The List's bulk actions and Excel export, wired to the API (RP-629). Each call answers null when it fails. */
function useSnagBulk(projectId: string, query: WorkItemQuery, locale: Locale, refresh: () => void): SnagBulk {
  const t = useTranslations("snagList.bulk");
  const l = useTranslations("workItemViews.list");
  const s = useTranslations("snagList");
  const post = async <T,>(path: string, body: unknown): Promise<T | null> => {
    const res = await fetch(`/api/v1/projects/${projectId}/snag-list/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  };
  const labels: SnagBulkLabels = {
    selected: (n, count) => t("selected", { n, count }),
    clearSelection: t("clearSelection"),
    selectAll: t("selectAll"),
    selectRow: (subject) => t("selectRow", { subject }),
    reassign: t("reassign"),
    moveStage: t("moveStage"),
    exportSelected: t("exportSelected"),
    exportAll: t("exportAll"),
    exported: (n, count) => t("exported", { n, count }),
    exportedCapped: (n, count) => t("exportedCapped", { n, count }),
    exportFailed: t("exportFailed"),
    close: t("close"),
    cancel: t("cancel"),
    working: t("working"),
    reassignTitle: t("reassignTitle"),
    reassignDescription: (n, count) => t("reassignDescription", { n, count }),
    reassignTo: t("reassignTo"),
    colleague: (name, n, of) => t("colleague", { name, n, of }),
    nothingToReassign: t("nothingToReassign"),
    reassignConfirm: t("reassignConfirm"),
    moveTitle: t("moveTitle"),
    moveDescription: (n, count) => t("moveDescription", { n, count }),
    moveTo: t("moveTo"),
    moveHint: t("moveHint"),
    moveConfirm: t("moveConfirm"),
    doneCount: (n, count) => t("doneCount", { n, count }),
    skippedCount: (n, count) => t("skippedCount", { n, count }),
    reasons: {
      not_found: t("reasons.not_found"),
      not_offered: t("reasons.not_offered"),
      needs_input: t("reasons.needs_input"),
      already_there: t("reasons.already_there"),
      refused: t("reasons.refused"),
    },
    unseen: (n, count) => t("unseen", { n, count }),
    failed: t("failed"),
  };
  return {
    actions: {
      labels,
      candidates: (ids) => post<SnagBulkCandidates>("reassign-candidates", { ids }),
      reassign: (ids, toMemberId) => post<SnagBulkResult>("reassign", { ids, toMemberId }),
      move: (ids, stage) => post<SnagBulkResult>("move", { ids, stage, idempotencyKey: crypto.randomUUID() }),
      onChanged: refresh,
    },
    exportLabels: {
      documentNumber: l("documentNumber"),
      subject: l("subject"),
      type: l("type"),
      trade: l("trade"),
      location: l("location"),
      stage: t("export.stage"),
      raisedFrom: s("raisedFrom"),
      with: l("with"),
      stepAgeWeeks: t("export.stepAgeWeeks"),
      raisedManually: s("raisedManually"),
      notPickedUp: l("notPickedUp"),
      noNumber: l("noNumber"),
      fileName: t("export.fileName"),
    },
    // Every row the viewer reads with the List's filters, through the List's own read (RP-409), at most 5,000.
    loadExportRows: async () => {
      const params = workItemSearchParams({ ...query, module: undefined, cursor: undefined, lang: locale });
      const res = await fetch(`/api/v1/projects/${projectId}/modules/snag_list/work-items/export?${params}`);
      return res.ok ? ((await res.json()) as WorkItemExport) : null;
    },
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
  const bulk = useSnagBulk(projectId, query, locale, () => router.refresh());
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
  // The thumbnails: only the photos the rows carry, those the viewer sees.
  const photoUrls = usePhotoUrls(rows.flatMap((r) => (r.photo ? [{ workItemId: r.id, documentId: r.photo.documentId, contentType: r.photo.contentType }] : [])));
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
      bulk={view === "list" ? bulk : undefined}
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
