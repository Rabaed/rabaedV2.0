"use client";

import {
  formatNumber,
  moduleTabPaths,
  workItemSearchParams,
  type Locale,
  type SnagBulkCandidates,
  type SnagBulkResult,
  type SnagReportState,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemExport,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemView,
} from "@rabaed/domain";
import { SnagList, WorkItemViewSwitch, useMediaQuery, type SnagBulk, type SnagBulkLabels, type SnagListLabels, type SnagNewType } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
// The hrefs here already carry their locale (the browser's own path, getPathname).
import NextLink from "next/link";
import { getPathname } from "@/i18n/navigation";
import { useSnagSwipe } from "@/components/snag-swipe";
import { usePhotoUrls } from "@/components/use-documents";
import { listSearchParams, snagListSort } from "@/lib/list-url";
import { newItemHref } from "@/lib/new-item-route";
import { phoneQuery } from "@/lib/new-submittal-panel";
import { givenLocation } from "@/lib/submittal-panel-url";
import { NewSubmittalPanelHost, useOpenNewSubmittal, type NewSubmittalPanelHooks } from "@/components/new-submittal-panel-host";

/** The views' words, from the app's messages. */
function useSnagLabels(tableLabel: string): SnagListLabels {
  const t = useTranslations("snagList");
  const l = useTranslations("workItemViews.list");
  const b = useTranslations("workItemViews.board");
  const m = useTranslations("snagList.mobile");
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
    questions: t("questions"),
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
    phone: {
      swipeHint: m("swipeHint"),
      showItems: (n, count) => m("showItems", { n, count }),
      transitionsOf: (subject) => m("transitionsOf", { subject }),
      loadingTransitions: m("loadingTransitions"),
      noTransitions: m("noTransitions"),
      transitionsUnavailable: m("transitionsUnavailable"),
    },
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
      item_closed: t("reasons.item_closed"),
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
    // The Snag report (RP-677): the worker makes the PDF from what the viewer reads now; the page asks after it.
    report: {
      labels: {
        exportPdf: t("exportPdf"),
        preparing: t("pdfPreparing"),
        download: (n, count) => t("pdfDownload", { n, count }),
        failed: t("pdfFailed"),
        gone: t("pdfGone"),
      },
      request: async (ids) => {
        const params = workItemSearchParams({ ...query, module: undefined, cursor: undefined, lang: locale });
        const res = await fetch(`/api/v1/projects/${projectId}/snag-list/reports?${params}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(ids ? { ids } : {}), language: locale }),
        });
        return res.ok ? ((await res.json()) as SnagReportState) : null;
      },
      check: async (id) => {
        const res = await fetch(`/api/v1/projects/${projectId}/snag-list/reports/${id}`);
        // It holds items the viewer can no longer see (RP-1110).
        if (res.status === 410) return "gone";
        return res.ok ? ((await res.json()) as SnagReportState) : null;
      },
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
  // On a phone: each card's Transitions behind a swipe (RP-630).
  const { swipe, dialog } = useSnagSwipe(locale);
  const pathname = usePathname();
  const cameraHref = useCallback(
    (code: string) => getPathname({ href: `/projects/${projectId}/${moduleTabPaths.snag_list}/new?type=${encodeURIComponent(code)}`, locale }),
    [projectId, locale],
  );
  const raising = useNewSnag({ projectId, locale, newTypes, cameraHref, refreshKey: props.view === "list" ? props.list : props.board });
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
    <>
      <SnagList
        data={props.view === "list" ? { view: "list", list: props.list } : { view: "kanban", board: props.board }}
        query={query}
        locale={locale}
        labels={labels}
        hrefFor={(q) => hrefIn(view, q)}
        itemHref={(id) => getPathname({ href: `/work-items/${id}`, locale })}
        onQueryChange={(q) => router.push(hrefIn(view, q))}
        newTypes={newTypes}
        newHref={(code) => getPathname({ href: newItemHref(projectId, "snag_list", code), locale })}
        // Off a phone, "+ New" opens the create panel over the List, at Wide as the Submittals' (RP-1222 rows 1, 2).
        onNew={raising.open}
        // On a phone, "+" opens the camera-first New page (RP-630; RP-1222 row 4).
        phoneNewHref={cameraHref}
        swipe={swipe}
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
      {dialog}
      {raising.slideOver}
    </>
  );
}

/** The Snag's own short form (RP-1222): the Snag Type only; another Snag List Type gets the panel as the Submittals have it (row 11). */
const snagTypeCode = "SNG";

/**
 * The create panel over the Snag List (RP-1222, on RP-1152's panel): `?new=SNG` opens it, as on the
 * Submittals, with `&location=<id>` when a Floor plan gives the Location (row 23). A Snag gets the
 * short form: no route, no rail, no Documents lock; photos wait until Save Draft; after each save
 * it clears for the next Snag, keeping the Trade and Location. On a phone the camera-first New Snag
 * stays (row 4), so a panel link sends the phone there.
 */
function useNewSnag({
  projectId,
  locale,
  newTypes,
  cameraHref,
  refreshKey,
}: {
  projectId: string;
  locale: Locale;
  newTypes: readonly SnagNewType[];
  cameraHref: (code: string) => string;
  refreshKey: unknown;
}) {
  const t = useTranslations("snagList.newSnag");
  const tTabs = useTranslations("projectTabs");
  const router = useRouter();
  const raising = useOpenNewSubmittal();
  const location = givenLocation(useSearchParams());
  const phone = useMediaQuery(phoneQuery, false);
  const newItem = raising.newItem;
  // The Type the panel opens on: the link's, else the Snag where the viewer may raise it, else their first.
  const type = newItem?.type ?? (newTypes.some((x) => x.code === snagTypeCode) ? snagTypeCode : (newTypes[0]?.code ?? null));
  // A Snag on a phone: the camera-first New Snag. Another Type (no photos to take first) gets the panel's phone page, as the camera page sends it here.
  const camera = phone && newItem !== null && type === snagTypeCode;
  useEffect(() => {
    if (camera) router.replace(cameraHref(snagTypeCode));
  }, [camera, router, cameraHref]);
  const short: NewSubmittalPanelHooks = {
    routePreview: false,
    rail: false,
    documentsLock: false,
    filesBeforeSave: true,
    afterSave: "clear",
    keep: ["trade", "location"],
    given: location === null ? undefined : { location },
    savedCount: (n) => t("saved", { count: n, n: formatNumber(n, locale) }),
    savedToast: { title: t("toast"), open: t("open") },
  };
  return {
    open: (code: string) => raising.open({ type: code, size: "wide" }),
    slideOver: newItem && !camera && (
      <NewSubmittalPanelHost
        projectId={projectId}
        module="snag_list"
        look={{ module: tTabs("snag_list"), back: t("back"), icon: "alert-triangle", ...(type === snagTypeCode ? { subjectPlaceholder: t("subjectPlaceholder") } : {}) }}
        type={type}
        onTypeChange={(code) => raising.open({ type: code })}
        draft={newItem.draft}
        onDraftSaved={raising.saved}
        onClose={raising.close}
        locale={locale}
        refreshKey={refreshKey}
        {...(type === snagTypeCode ? short : {})}
      />
    ),
  };
}
