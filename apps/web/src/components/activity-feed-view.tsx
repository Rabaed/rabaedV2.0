"use client";

import { activityFeedSearchParams, type ActivityFeed, type Locale } from "@rabaed/domain";
import { ActivityFeedPanel, type ActivityFeedFilters, type ActivityFeedPanelLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The Activity Feed panel (RP-353), live: its first page comes from the server;
 * filters and older pages are read in the browser, through the /api/v1 proxy,
 * as the signed-in Member may see them.
 */
export function ActivityFeedView({
  projectId,
  initial,
  locale,
  fullHeight = false,
}: {
  projectId: string;
  /** The first page; its `types` name the Project's Modules and Types, for the filters. */
  initial: ActivityFeed;
  locale: Locale;
  fullHeight?: boolean;
}) {
  const t = useTranslations("workItemViews.activityFeed");
  const labels: ActivityFeedPanelLabels = {
    title: t("title"),
    module: t("module"),
    type: t("type"),
    all: t("all"),
    mine: t("mine"),
    viewAll: t("viewAll"),
    loadMore: t("loadMore"),
    loading: t("loading"),
    empty: t("empty"),
    internal: t("internal"),
    noNumber: t("noNumber"),
    pickedUp: t("pickedUp"),
    returnedToPool: t("returnedToPool"),
    assigned: t("assigned"),
    internalNote: t("internalNote"),
    recommended: t("recommended"),
    cancelled: t("cancelled"),
    updated: t("updated"),
  };
  const [query, setQuery] = useState<ActivityFeedFilters>({ type: [], mine: false });
  const [entries, setEntries] = useState(initial.entries);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  // Only the latest request's answer is shown: a filter changed meanwhile wins.
  const latest = useRef(0);

  async function load(filters: ActivityFeedFilters, cursor: string | null) {
    const request = ++latest.current;
    setLoading(true);
    try {
      const params = activityFeedSearchParams({ ...filters, ...(cursor ? { cursor } : {}) }).toString();
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/activity${params ? `?${params}` : ""}`);
      if (!res.ok || request !== latest.current) return;
      const page = (await res.json()) as ActivityFeed;
      setEntries((before) => (cursor ? [...before, ...page.entries] : page.entries));
      setNextCursor(page.nextCursor);
    } catch {
      // Left as it was; "Load more" tries again.
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }

  return (
    <ActivityFeedPanel
      entries={entries}
      hasMore={nextCursor !== null}
      loading={loading}
      onLoadMore={() => {
        if (!loading && nextCursor) void load(query, nextCursor);
      }}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        void load(next, null);
      }}
      types={initial.types}
      locale={locale}
      labels={labels}
      // Link adds the locale.
      itemHref={(id) => `/work-items/${id}`}
      viewAllHref={fullHeight ? undefined : `/projects/${projectId}/activity`}
      fullHeight={fullHeight}
      linkAs={Link}
    />
  );
}
