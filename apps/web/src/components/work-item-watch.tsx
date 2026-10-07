"use client";

import { WatchButton, type WatchCall } from "@rabaed/ui";
import { useTranslations } from "next-intl";

/**
 * Watch / Watching on the item page (RP-354): the viewer's own Watch, which
 * covers the item's whole Revision chain. Watch is PUT, Unwatch is DELETE.
 */
export function WorkItemWatch({ workItemId, watching }: { workItemId: string; watching: boolean }) {
  const t = useTranslations("watch");
  const change: WatchCall = async (watch) => {
    const res = await fetch(`/api/v1/work-items/${workItemId}/watch`, { method: watch ? "PUT" : "DELETE" });
    if (res.ok) return { ok: true };
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: error ?? "unavailable" };
  };
  const labels = { watch: t("watch"), watching: t("watching"), refusals: { not_found: t("notFound"), unavailable: t("unavailable") } };
  return <WatchButton labels={labels} watching={watching} onChange={change} />;
}
