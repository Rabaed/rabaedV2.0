"use client";

import {
  listColumnKeys,
  watchOutcomeNames,
  type ListColumnKey,
  workItemSearchParams,
  type BoardCardLayout,
  type BoardCardLayoutChange,
  type Locale,
  type ModuleView,
  type PackageSummary,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemExport,
  type WorkItemDetail,
  type WorkItemList as WorkItemListData,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemView,
} from "@rabaed/domain";
import {
  BoardLayoutMenu,
  MoreActionsMenu,
  type MoreAction,
  WorkItemBoard,
  WorkItemList,
  WorkItemViewSwitch,
  type BoardLayoutMenuLabels,
  type RowAction,
  type WholeTableLabels,
  type RowPermissions,
  type WorkItemBoardLabels,
  type WorkItemFilterHints,
  type WorkItemImportFilter,
  type WorkItemListLabels,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
// The hrefs here already carry their locale (the browser's own path, getPathname): next/link keeps navigation
// client-side without adding the locale again.
import NextLink from "next/link";
import { SubmittalPanelHost, useOpenSubmittal } from "@/components/submittal-panel-host";
import { WorkItemBoardMove } from "@/components/work-item-board-move";
import { getPathname } from "@/i18n/navigation";
import { chainLabels } from "@/lib/chain-labels";
import { itemPdfProblemMessage, openItemPdf } from "@/lib/item-pdf";
import { listSearchParams } from "@/lib/list-url";

/** An item as the viewer reads it, with what they may press now; null when it can't be read. */
async function readItem(id: string): Promise<WorkItemDetail | null> {
  const res = await fetch(`/api/v1/work-items/${id}`);
  return res.ok ? ((await res.json()) as WorkItemDetail) : null;
}

/**
 * A row's ⋯ menu: Edit an own Draft the viewer may change; Duplicate, Resubmit (create a Revision) and
 * Delete (discard one's own Draft, any Draft never numbered) as the item's actions say; Download for whoever reads it:
 * its Working Copy while it is open (a Draft's too, for the Members who see it), its Documental Record once published (RP-621).
 */
async function rowPermissions(row: WorkItemRow): Promise<RowPermissions | null> {
  const item = await readItem(row.id);
  if (!item) return null;
  return {
    edit: item.stage.category === "draft" && item.actions.saveAnswers,
    duplicate: item.actions.duplicate,
    resubmit: item.actions.createRevision,
    download: item.outcome === null || item.documentalRecord === "published",
    delete: item.actions.discardDraft,
  };
}

/**
 * What the row alone says, offered while the item is read (RP-1175, UAT SUB-18): a row the viewer reads
 * that isn't closed offers its Working Copy, the same shared content for every viewer, another Company's
 * Submitted item included. A closed one waits for the item to say its Documental Record is published.
 */
function rowKnown(row: WorkItemRow): Partial<RowPermissions> {
  return { download: row.outcome === null };
}

/** The List's and the Kanban's words, from the app's messages. */
function useViewLabels(tableLabel: string, module: string): { list: WorkItemListLabels; board: WorkItemBoardLabels; layout: BoardLayoutMenuLabels } {
  const t = useTranslations("workItemViews");
  const l = (key: string) => t(`list.${key}`);
  const locale = useLocale() as Locale;
  const shared = {
    noNumber: l("noNumber"),
    revisionNoNumber: (revision: string) => t("list.revisionNoNumber", { revision }),
    notPickedUp: l("notPickedUp"),
    // Cancelled is named once, with the notifications (watchOutcomeNames); every other outcome by its Type's set (RP-429).
    cancelled: watchOutcomeNames.cancelled[locale],
  };
  const keys = [
    "toolbar", "all", "type", "stage", "with", "withMe", "anyNotPickedUp", "trade", "location", "outcome", "stepAge",
    "submissionDate", "creationDate", "submittedFrom", "submittedTo", "allRevisions", "needMyAction", "clear",
    "empty", "search", "searchPlaceholder", "searchHelp", "noResults", "filters", "clearAll", "done",
    "close", "notifications", "pages", "firstPage", "previousPage", "nextPage", "lastPage", "rowsPerPage", "documentType", "owner", "role", "createdDate", "clearField",
    "searchValues", "noMatches", "searchPlaceholderBoard", "revisions", "statusField",
  ] as const;
  const layoutKeys = ["title", "boardSettings", "fixedParts", "alwaysShown", "contractorName", "location", "creationDate", "preview"] as const;
  return {
    list: {
      ...(Object.fromEntries(keys.map((key) => [key, l(key)])) as Record<(typeof keys)[number], string>),
      ...shared,
      table: tableLabel,
      // The owner's design names the Submittals' number "Submittal No."; any other Module's is its Document Number.
      columns: {
        ...(Object.fromEntries(listColumnKeys.map((key) => [key, t(`list.columns.${key}`)])) as Record<ListColumnKey, string>),
        ...(module === "submittals" ? {} : { documentNumber: l("documentNumber") }),
      },
      sortBy: (column) => t("list.sortBy", { column }),
      selectAll: l("selectAll"),
      selectRow: (subject) => t("list.selectRow", { subject }),
      selected: (n, count) => t("list.selected", { n, count }),
      clearSelection: l("clearSelection"),
      group: l("group"),
      groupBy: l("groupBy"),
      groupedBy: (by) => t("list.groupedBy", { by }),
      clearGrouping: l("clearGrouping"),
      groupNone: l("groupNone"),
      export: l("export"),
      exportOptions: l("exportOptions"),
      csv: l("csv"),
      excel: l("excel"),
      exportSelected: l("exportSelected"),
      exported: (n, count, format) => t("list.exported", { what: t(module === "submittals" ? "list.submittals" : "list.items", { n, count }), format }),
      exportedCapped: (n, count, format) => t("list.exportedCapped", { what: t(module === "submittals" ? "list.submittals" : "list.items", { n, count }), format }),
      exportShown: l("exportShown"),
      exportWhole: l("exportWhole"),
      wholeTable: Object.fromEntries((["typeName", "location", "creationDate", "submissionDate", "project"] as const).map((key) => [key, t(`list.wholeTable.${key}`)])) as WholeTableLabels,
      groupCount: (n, count) => t("list.groupCount", { n, count }),
      rowMenu: {
        ...(Object.fromEntries((["open", "edit", "duplicate", "resubmit", "download", "delete", "loading", "deleteTitle", "cancel"] as const).map((key) => [key, t(`list.rowMenu.${key}`)])) as Record<
          "open" | "edit" | "duplicate" | "resubmit" | "download" | "delete" | "loading" | "deleteTitle" | "cancel",
          string
        >),
        more: (subject) => t("list.rowMenu.more", { subject }),
        deleteBody: (subject) => t("list.rowMenu.deleteBody", { subject }),
      },
      columnSettings: {
        ...(Object.fromEntries((["settings", "title", "locked", "reset", "saveDefault", "saved"] as const).map((key) => [key, t(`list.columnSettings.${key}`)])) as Record<
          "settings" | "title" | "locked" | "reset" | "saveDefault" | "saved",
          string
        >),
        shown: (shown, total) => t("list.columnSettings.shown", { shown, total }),
        move: (column) => t("list.columnSettings.move", { column }),
      },
      code: (code) => t("board.code", { code }),
      revision: (n) => t("board.revision", { n }),
      weeksOrMore: (weeks, count) => t("list.weeksOrMore", { weeks, count }),
      filtersApplied: (n, count) => t("list.filtersApplied", { n, count }),
      page: (page) => t("list.page", { page }),
      pageOf: (page, pages) => t("list.pageOf", { page, pages }),
      // "42 submittals" on the Submittals, as the owner's design has it; "42 items" elsewhere.
      items: (n, count) => t(module === "submittals" ? "list.submittals" : "list.items", { n, count }),
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
      showOnlyStep: (step) => t("board.showOnlyStep", { step }),
      mixed: t("board.mixed"),
      roleLane: (role, position) => t("board.roleLane", { role, position }),
      revision: (n) => t("board.revision", { n }),
      code: (code) => t("board.code", { code }),
      createdOn: (date) => t("board.createdOn", { date }),
      submittedOn: (date) => t("board.submittedOn", { date }),
      openPackage: (number, company, name) => t("board.openPackage", { number, company, name }),
    },
    layout: Object.fromEntries(layoutKeys.map((key) => [key, t(`layout.${key}`)])) as BoardLayoutMenuLabels,
  };
}

/**
 * A Module tab's items as the List or the Kanban, with the toolbar and the
 * View switch: every filter, sort, page and the View are the page's own URL,
 * so a view can be bookmarked or shared and the back button undoes a filter.
 * The List's URL keeps its numbered page and rows per page (`list-url`).
 */
export function WorkItemListOrKanban(
  props: {
    query: WorkItemQuery;
    locale: Locale;
    tableLabel: string;
    /** The toolbar's primary action, e.g. "New Submittal". */
    action?: ReactNode;
    /** The toolbar's ⋯ "More actions" menu (RP-637: Import register, Imports), each link with its locale; none, no menu. */
    moreActions?: MoreAction[];
    /** The Project and Module of the tab: the board's Card view layout and collapsed groups are kept per board. */
    projectId: string;
    module: string;
    /** The Project's name, for "the whole table" Export. */
    projectName?: string;
    /** The filter fields' names in the other language. */
    hints?: WorkItemFilterHints;
    /** The Submittals' Package filter (RP-662): the Project's Packages the Member sees; none, no Package field. */
    packages?: PackageSummary[];
    /** One import's Drafts (RP-954): the chip naming the import the List is filtered to. */
    importFilter?: WorkItemImportFilter;
  } & ({ view: "list"; list: WorkItemListData } | { view: "kanban"; board: WorkItemBoardData }),
) {
  const { query, locale, view, action, moreActions, projectId, module, hints, projectName } = props;
  const t = useTranslations("workItemViews");
  const tRecord = useTranslations("documentalRecord");
  const labels = useViewLabels(props.tableLabel, module);
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
  const hrefIn = (v: WorkItemView, q: WorkItemQuery) => {
    // The tab's path names the Module, so the query string doesn't. The Kanban has no pages.
    const params =
      v === "list"
        ? listSearchParams({ ...q, module: undefined })
        : workItemSearchParams({ ...q, module: undefined, cursor: undefined, page: undefined, pageSize: undefined, lang: undefined });
    if (v === "kanban") params.set("view", "kanban");
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const hrefFor = (q: WorkItemQuery) => hrefIn(view, q);
  // The Submittals open a row or card in the Submittal Panel (RP-1061); `?open=<id>` keeps it.
  const opened = useOpenSubmittal();
  const submittal = module === "submittals" ? opened : null;
  const openId = submittal?.openId ?? undefined;
  const onOpen = submittal ? (row: WorkItemRow) => submittal.open(row.id) : undefined;
  const loaded = props.view === "list" ? props.list : props.board;
  const itemHref = (id: string) => getPathname({ href: `/work-items/${id}`, locale });
  const post = (path: string, body: unknown) =>
    fetch(`/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const runRowAction = async (row: WorkItemRow, action: RowAction): Promise<string | null> => {
    const failed = t("list.rowMenu.failed");
    switch (action) {
      case "open":
      case "edit":
        router.push(itemHref(row.id));
        return null;
      case "download": {
        // Its Documental Record once closed, else its Working Copy (RP-621): the same PDF for every viewer.
        const problem = await openItemPdf(row.id, row.outcome !== null);
        return problem === null ? null : tRecord(itemPdfProblemMessage(problem));
      }
      case "resubmit":
      case "duplicate": {
        // A key per request, so a double-click makes one Revision or one Draft.
        const res = await post(`/work-items/${row.id}/${action === "resubmit" ? "revisions" : "duplicate"}`, { idempotencyKey: crypto.randomUUID() });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          return error === "duplicate_files_too_large" ? t("list.rowMenu.duplicateTooLarge") : failed;
        }
        router.push(itemHref(((await res.json()) as { id: string }).id));
        return null;
      }
      case "delete": {
        const res = await post(`/work-items/${row.id}/discard-draft`, {});
        if (!res.ok) return failed;
        router.refresh();
        return t("list.rowMenu.discarded");
      }
    }
  };
  return (
    <>
    <WorkItemList
      list={props.view === "list" ? props.list : { ...props.board, items: [], nextCursor: null }}
      onOpen={props.view === "list" ? onOpen : undefined}
      openId={openId}
      query={query}
      locale={locale}
      labels={labels.list}
      hrefFor={hrefFor}
      itemHref={itemHref}
      linkAs={NextLink}
      onQueryChange={(q) => router.push(hrefFor(q))}
      // Export: the rows the Member reads with this query, through the List's own read (RP-409); under
      // a search, the pages read so far (to this one). At most 5,000 rows: `capped` says when it stopped.
      loadExportRows={
        props.view === "list"
          ? async () => {
              const params = workItemSearchParams({ ...query, module: undefined, cursor: undefined, lang: locale });
              const res = await fetch(`/api/v1/projects/${projectId}/modules/${module}/work-items/export?${params}`);
              return res.ok ? ((await res.json()) as WorkItemExport) : null;
            }
          : undefined
      }
      projectName={projectName}

      // Each row's ⋯ menu (RP-409): what the viewer may do, from the item as the API gives it (the same
      // actions as the item page); every command is checked again by the API when it is taken.
      rowActions={props.view === "list" ? { load: rowPermissions, known: rowKnown, run: (row, action) => runRowAction(row, action) } : undefined}
      // The Member's own columns of the Module, kept by the API (RP-409).
      onSaveColumns={
        props.view === "list"
          ? async (columns) =>
              (
                await fetch(`/api/v1/projects/${projectId}/modules/${module}/work-items/list/columns`, {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(columns),
                })
              ).ok
          : undefined
      }
      action={action}
      hints={hints}
      // No Package field for a Member who sees none, unless the URL already holds one (so it can be cleared).
      packages={props.packages && (props.packages.length > 0 || query.packageId) ? { label: t("list.package"), choices: props.packages } : undefined}
      importFilter={props.importFilter}
      moreActions={moreActions && moreActions.length > 0 && <MoreActionsMenu actions={moreActions} label={t("moreActions")} linkAs={NextLink} />}
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
          <WorkItemViewSwitch<ModuleView>
            view={view}
            // The Submittals also offer their Packages (RP-660).
            views={module === "submittals" ? ["kanban", "list", "packages"] : ["kanban", "list"]}
            labels={{ view: t("viewSwitch.view"), list: t("viewSwitch.list"), kanban: t("viewSwitch.kanban"), packages: t("viewSwitch.packages") }}
            // Each View in its own order: the List by Submittal No., the Kanban by Step Age. The Packages view takes no filter.
            hrefFor={(v) =>
              v === "packages"
                ? `${pathname}?view=packages`
                : hrefIn(v, { ...query, cursor: undefined, page: undefined, sort: v === "list" ? "documentNumber" : "stepAge", dir: undefined })
            }
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
              // A card's Package chip, where the API gives the item's Package (RP-659).
              packageHref={(id) => getPathname({ href: `/packages/${id}`, locale })}
              linkAs={NextLink}
              onMove={(card, move) => setMoving({ card, move })}
              onOpen={onOpen}
              openId={openId}
            />
            {/* A drop, or the card's Move menu, opens the Transition's Action Form. */}
            {moving && <WorkItemBoardMove key={`${moving.card.id}:${moving.move.transition}`} {...moving} locale={locale} onClose={() => setMoving(null)} />}
          </>
        ) : undefined
      }
    />
    {submittal?.openId && (
      <SubmittalPanelHost
        openId={submittal.openId}
        onOpen={submittal.open}
        onClose={submittal.close}
        locale={locale}
        filters={loaded.filters}
        refreshKey={loaded}
      />
    )}
    </>
  );
}
