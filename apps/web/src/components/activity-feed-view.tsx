"use client";

import { activityFeedSearchParams, formatNumber, type ActivityFeed, type Locale } from "@rabaed/domain";
import { ActivityFeedPage, ActivityFeedPanel, type ActivityFeedFilters, type ActivityFeedPageLabels, type ActivityFeedPanelLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The feed's entries, live: the first page comes from the server; filters and older pages are read in
 * the browser, through the /api/v1 proxy, as the signed-in Member may see them.
 */
function useActivityFeed(projectId: string, initial: ActivityFeed) {
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

  return {
    entries,
    hasMore: nextCursor !== null,
    loading,
    onLoadMore: () => {
      if (!loading && nextCursor) void load(query, nextCursor);
    },
    query,
    onQueryChange: (next: ActivityFeedFilters) => {
      setQuery(next);
      void load(next, null);
    },
    types: initial.types,
  };
}

/** The words `whatHappened` reads, for the panel and the page alike. */
function useEventLabels() {
  const t = useTranslations("workItemViews.activityFeed");
  return {
    pickedUp: t("pickedUp"),
    returnedToPool: t("returnedToPool"),
    assigned: t("assigned"),
    internalNote: t("internalNote"),
    recommended: t("recommended"),
    cancelled: t("cancelled"),
    updated: t("updated"),
  };
}

/** The Activity Feed panel on the Project's Dashboard (RP-353), with "View all" to its page. */
export function ActivityFeedView({ projectId, initial, locale }: { projectId: string; initial: ActivityFeed; locale: Locale }) {
  const t = useTranslations("workItemViews.activityFeed");
  const labels: ActivityFeedPanelLabels = {
    ...useEventLabels(),
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
  };
  return (
    <ActivityFeedPanel
      {...useActivityFeed(projectId, initial)}
      locale={locale}
      labels={labels}
      // Link adds the locale.
      itemHref={(id) => `/work-items/${id}`}
      viewAllHref={`/projects/${projectId}/activity`}
      linkAs={Link}
    />
  );
}

/** The Activity Feed page (RP-1157, the owner's reference): the whole feed, grouped by day. */
export function ActivityFeedPageView({
  projectId,
  projectName,
  initial,
  locale,
  now,
}: {
  projectId: string;
  projectName: string;
  /** The first page; its `types` name the Project's Modules and Types, for the filters. */
  initial: ActivityFeed;
  locale: Locale;
  /** When the server made the page (ISO), for "Today" and "Yesterday". */
  now: string;
}) {
  const t = useTranslations("workItemViews.activityFeed");
  const labels: ActivityFeedPageLabels = {
    ...useEventLabels(),
    title: t("title"),
    description: t("description", { project: projectName }),
    allModules: t("allModules"),
    allTypes: t("allTypes"),
    mine: t("mine"),
    count: (n) => t("count", { count: n, n: formatNumber(n, locale) }),
    today: t("today"),
    yesterday: t("yesterday"),
    you: t("you"),
    onItem: t("onItem"),
    internal: t("internal"),
    code: (code) => t("code", { code }),
    noNumber: t("noNumber"),
    scrollForOlder: t("scrollForOlder"),
    loading: t("loading"),
    emptyTitle: t("emptyTitle"),
    emptyFiltered: t("emptyFiltered"),
    emptyNone: t("empty"),
  };
  return (
    <ActivityFeedPage
      {...useActivityFeed(projectId, initial)}
      locale={locale}
      labels={labels}
      itemHref={(id) => `/work-items/${id}`}
      now={now}
      linkAs={Link}
    />
  );
}
