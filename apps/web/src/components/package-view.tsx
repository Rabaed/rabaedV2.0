"use client";

import {
  listColumnKeys,
  packageNotReadyReasons,
  watchOutcomeNames,
  workItemSearchParams,
  type BilingualText,
  type ListColumnKey,
  type Locale,
  type PackageNotReadyItem,
  type WorkItemList,
  type WorkItemRow,
} from "@rabaed/domain";
import {
  PackagePage,
  type PackageItemSearch,
  type PackagePageLabels,
  type PackagePageProps,
  type SubmitPackageCall,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import NextLink from "next/link";
import { useCallback, useRef } from "react";
import { usePackageBulkCalls } from "@/components/package-bulk";
import { getPathname, useRouter } from "@/i18n/navigation";
import { messageKeys } from "@/lib/message-keys";

type Result = { ok: true } | { ok: false; reason: string };

/** A command to the API: its error code when refused. */
async function call(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (res.ok) return { ok: true };
  const { error } = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, reason: error ?? "unavailable" };
}

/** The Package page's words, from the app's messages. */
function usePackageLabels(): PackagePageLabels {
  const t = useTranslations("packages");
  const v = useTranslations("workItemViews");
  const locale = useLocale() as Locale;
  const keys = messageKeys((key) => t(key));
  return {
    breadcrumb: t("breadcrumb"),
    back: t("back"),
    kind: t("kind"),
    status: keys("status", ["open", "in_progress", "done"] as const),
    ownedBy: t("ownedBy"),
    progress: t("progress"),
    closedOf: (closed, total) => t("closedOf", { closed, total }),
    code: (code) => t("code", { code }),
    stillOpen: t("stillOpen"),
    submittals: t("submittals"),
    empty: t("empty"),
    done: t("done"),
    actions: t("actions"),
    with: t("with"),
    remove: (subject) => t("remove", { subject }),
    close: t("close"),
    cancel: t("cancel"),
    refusals: keys("refusals", ["unavailable", "in_another_package", "item_not_offered", "package_not_open", "project_closed", "nothing_to_submit", "invalid_name"] as const),
    table: {
      table: t("table"),
      columns: Object.fromEntries(listColumnKeys.map((key) => [key, v(`list.columns.${key}`)])) as Record<ListColumnKey, string>,
      sortBy: (column) => v("list.sortBy", { column }),
      noNumber: v("list.noNumber"),
      revisionNoNumber: (revision) => v("list.revisionNoNumber", { revision }),
      notPickedUp: v("list.notPickedUp"),
      // Cancelled is named once, with the notifications; every other outcome by its Type's set (RP-429).
      cancelled: watchOutcomeNames.cancelled[locale],
      code: (code) => v("board.code", { code }),
      revision: (n) => v("board.revision", { n }),
      empty: t("empty"),
    },
    rename: keys("rename", ["trigger", "title", "description", "nameEn", "nameAr", "required", "save"] as const),
    delete: { ...keys("delete", ["trigger", "description", "confirm"] as const), title: (number) => t("delete.title", { number }) },
    addItems: {
      ...keys("addItems", ["trigger", "title", "description", "search", "searchPlaceholder", "trade", "allTrades", "loading", "noResults", "results", "inThis", "numberOnSubmit"] as const),
      inOther: (number) => t("addItems.inOther", { number }),
      choose: (subject) => t("addItems.choose", { subject }),
      add: (_n, count) => t("addItems.add", { count }),
    },
    submit: {
      ...keys("submit", ["trigger", "description", "confirm", "numberOnSubmit", "notReadyTitle", "notReadyIntro", "othersNotReady"] as const),
      title: (number) => t("submit.title", { number }),
      count: (_n, count) => t("submit.count", { count }),
      reasons: keys("submit.reasons", packageNotReadyReasons),
    },
  };
}

/**
 * The Package page's calls (RP-659): rename, delete, remove and add items, and Submit Package,
 * each through the Packages API (RP-636, RP-638), which checks each again. After a change the page
 * reads the Package again; a deleted one leads back to the Submittals.
 */
export function PackageView({ pkg, rows, filters, locale }: Pick<PackagePageProps, "pkg" | "rows" | "filters" | "locale">) {
  const router = useRouter();
  const labels = usePackageLabels();
  const bulk = usePackageBulkCalls(pkg.id);
  // Submit Package's key, kept until it is taken, so a double click or a retry Submits once.
  const submitKey = useRef<string | null>(null);
  const back = `/projects/${pkg.projectId}/work-items`;
  const refreshed = async (result: Promise<Result>) => {
    const r = await result;
    if (r.ok) router.refresh();
    return r;
  };

  const searchItems: PackageItemSearch = useCallback(
    async ({ q, trade }) => {
      // The owner's own Company's submittals they see, as the List reads them.
      const params = workItemSearchParams({ raisedByMe: true, q: q || undefined, trade: trade ? [trade] : [], sort: "documentNumber", page: 1, pageSize: 50, lang: locale });
      const res = await fetch(`/api/v1/projects/${pkg.projectId}/modules/submittals/work-items?${params}`);
      return res.ok ? ((await res.json()) as WorkItemList).items : null;
    },
    [pkg.projectId, locale],
  );

  const onSubmit: SubmitPackageCall = async () => {
    submitKey.current ??= crypto.randomUUID();
    const res = await fetch(`/api/v1/packages/${pkg.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, idempotencyKey: submitKey.current }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      submitted?: unknown[];
      error?: string;
      notReady?: PackageNotReadyItem[];
      othersNotReady?: boolean;
    };
    if (res.ok) {
      submitKey.current = null;
      router.refresh();
      return { ok: true, submitted: body.submitted?.length ?? 0 };
    }
    if (body.error === "package_not_ready") return { ok: false, reason: "package_not_ready", notReady: body.notReady ?? [], othersNotReady: body.othersNotReady ?? false };
    return { ok: false, reason: body.error ?? "unavailable" };
  };

  return (
    <PackagePage
      pkg={pkg}
      rows={rows}
      filters={filters}
      locale={locale}
      labels={labels}
      backHref={getPathname({ href: back, locale })}
      itemHref={(id) => getPathname({ href: `/work-items/${id}`, locale })}
      // The hrefs already carry their locale (getPathname): next/link keeps navigation client-side without adding it again.
      linkAs={NextLink}
      onRename={(name: BilingualText) => refreshed(call(`/packages/${pkg.id}`, "PATCH", { name }))}
      onDelete={async () => {
        const r = await call(`/packages/${pkg.id}`, "DELETE");
        if (r.ok) router.replace(back);
        return r;
      }}
      onRemove={(row: WorkItemRow) => refreshed(call(`/packages/${pkg.id}/items/${row.id}`, "DELETE"))}
      searchItems={searchItems}
      onAdd={async (ids) => {
        // One at a time; the first refusal stops the rest, and what was added stays.
        let result: Result = { ok: true };
        for (const workItemId of ids) {
          result = await call(`/packages/${pkg.id}/items`, "POST", { workItemId });
          if (!result.ok) break;
        }
        router.refresh();
        return result;
      }}
      onSubmit={onSubmit}
      bulk={bulk}
    />
  );
}
