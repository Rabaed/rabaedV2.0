"use client";

import { formatDate, type Locale, type Notification } from "@rabaed/domain";
import { NotificationRow } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { notificationHref, notificationLook, timeLabel, whatHappened } from "@/lib/notifications";

/** Marks notification `id` read; the request finishes even as the page navigates away. */
export function markRead(id: string): void {
  void fetch("/api/v1/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [id] }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * One notification in the bell or on the Notifications page (RP-1153): what happened, its number
 * and Subject (or its Package), its Project, Watching or the pool hint, and how long ago, as of
 * `now`. Opening it marks it read; if marking fails, the item still opens.
 */
export function NotificationItem({ n, now, layout, onOpen }: { n: Notification; now: Date; layout: "menu" | "page"; onOpen?: () => void }) {
  const t = useTranslations("notifications");
  const locale = useLocale() as Locale;
  const what = whatHappened(n, locale);
  const time = timeLabel(new Date(n.createdAt), now, locale);
  const look = notificationLook(n);
  // A Package Submit names its Package: its number (not a Document Number) and name.
  const [number, subject] = n.kind === "package_submitted" ? [n.package.number, n.package.name[locale]] : [n.documentNumber, n.title];
  const full = formatDate(new Date(n.createdAt), locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <NotificationRow
      href={notificationHref(n)}
      linkAs={Link}
      icon={look.icon}
      tone={look.tone}
      what={t(`what.${what.key}`, what.values)}
      documentNumber={number}
      subject={subject}
      project={n.project.name[locale]}
      watching={n.kind === "watched_event" ? t("watching") : undefined}
      hint={n.pool?.waiting && !n.readAt ? t("poolHint") : undefined}
      time={t(`time.${time.key}`, time.values)}
      dateTime={n.createdAt}
      timeTitle={full}
      unread={!n.readAt}
      unreadLabel={t("unread")}
      layout={layout}
      onOpen={() => {
        if (!n.readAt) markRead(n.id);
        onOpen?.();
      }}
    />
  );
}
