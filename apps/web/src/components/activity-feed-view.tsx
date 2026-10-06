"use client";

import { activityFeedSearchParams, type ActivityFeed, type Dashboard, type Locale } from "@rabaed/domain";
import { ActivityFeedPanel, type ActivityFeedFilters } from "@rabaed/ui";
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
  dashboard,
  locale,
  fullHeight = false,
}: {
  projectId: string;
  initial: ActivityFeed;
  /** The Dashboard: its Type cards name the Project's Modules and Types, for the filters. */
  dashboard: Dashboard;
  locale: Locale;
  fullHeight?: boolean;
}) {
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
      types={dashboard.modules.flatMap((m) => m.cards.map((c) => ({ code: c.type.code, name: c.type.name, moduleKey: m.key })))}
      locale={locale}
      // Link adds the locale.
      itemHref={(id) => `/work-items/${id}`}
      viewAllHref={fullHeight ? undefined : `/projects/${projectId}/activity`}
      fullHeight={fullHeight}
      linkAs={Link}
    />
  );
}
