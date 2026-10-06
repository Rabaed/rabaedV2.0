"use client";

import type { Locale } from "@rabaed/domain";
import { WatchButton, type WatchCall } from "@rabaed/ui";

/**
 * Watch / Watching on the item page (RP-354): the viewer's own Watch, which
 * covers the item's whole Revision chain. Watch is PUT, Unwatch is DELETE.
 */
export function WorkItemWatch({ workItemId, watching, locale }: { workItemId: string; watching: boolean; locale: Locale }) {
  const change: WatchCall = async (watch) => {
    const res = await fetch(`/api/v1/work-items/${workItemId}/watch`, { method: watch ? "PUT" : "DELETE" });
    if (res.ok) return { ok: true };
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: error ?? "unavailable" };
  };
  return <WatchButton locale={locale} watching={watching} onChange={change} />;
}
