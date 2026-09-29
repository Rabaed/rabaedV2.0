"use client";

import { Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";

const REFRESH_MS = 60_000;

/**
 * The header bell: a link to the Member's notifications, with how many are
 * unread. The layout renders it once; it reads the count again on every
 * navigation and each minute, so it never goes stale while the Member moves around.
 */
export function NotificationBell({ unread: initial }: { unread: number }) {
  const t = useTranslations("notifications");
  const pathname = usePathname();
  const [unread, setUnread] = useState(initial);

  useEffect(() => setUnread(initial), [initial]);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/v1/notifications", { cache: "no-store" });
        if (res.ok && live) setUnread(((await res.json()) as { unread: number }).unread);
      } catch {
        // Keep the last count; the next refresh tries again.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pathname]);

  const label = unread ? t("bellUnread", { count: unread, shown: String(unread) }) : t("title");
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-sm"
      data-testid="notification-bell"
    >
      <Icon name="bell" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold text-on-primary"
        >
          <bdi dir="ltr">{unread > 99 ? "99+" : unread}</bdi>
        </span>
      )}
    </Link>
  );
}
