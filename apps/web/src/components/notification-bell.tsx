"use client";

import type { NotificationList } from "@rabaed/domain";
import { NotificationEmpty, NotificationMenu, useToast } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { NotificationItem } from "./notification-item";

const REFRESH_MS = 60_000;
/** How many the dropdown shows: the latest, read or not. */
const LATEST = 7;

/**
 * The header bell (RP-1153, the owner's design): its unread count, and a dropdown (a full-screen
 * sheet on a phone) of the latest notifications, with Mark all as read, the settings and View all.
 * The layout renders it once with the list it read; it reads the list again on every navigation,
 * each minute and when it opens, so a notification a colleague's pick-up withdrew is gone then.
 */
export function NotificationBell({ initial }: { initial: NotificationList }) {
  const t = useTranslations("notifications");
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState(initial);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => setList(initial), [initial]);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications", { cache: "no-store" });
      if (res.ok) {
        setList((await res.json()) as NotificationList);
        setNow(new Date());
      }
    } catch {
      // Keep the last list; the next refresh tries again.
    }
  }, []);
  useEffect(() => {
    // A new page (View all, the settings, an item) closes the dropdown.
    setOpen(false);
    let live = true;
    const run = () => live && void refresh();
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pathname, refresh]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) void refresh();
  };

  async function markAll() {
    try {
      const res = await fetch("/api/v1/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(String(res.status));
      toast({ title: t("markedAllRead"), tone: "success" });
    } catch {
      toast({ title: t("unavailable"), tone: "danger" });
    }
    await refresh();
    // The Notifications page, if it is open, shows them read too.
    router.refresh();
  }

  const { unread } = list;
  const latest = list.notifications.slice(0, LATEST);
  const label = unread ? t("bellUnread", { count: unread, shown: String(unread) }) : t("title");
  return (
    <span data-testid="notification-bell">
      <NotificationMenu
        open={open}
        onOpenChange={changeOpen}
        label={label}
        count={unread}
        title={t("title")}
        newLabel={unread ? t("new", { n: String(unread) }) : null}
        markAll={{ label: t("markAllRead"), disabled: unread === 0, onClick: () => void markAll() }}
        settings={{ href: "/profile#notification-settings", label: t("settings") }}
        viewAll={{ href: "/notifications?show=all", label: t("viewAll") }}
        closeLabel={t("close")}
        linkAs={Link}
      >
        {latest.length ? (
          latest.map((n) => <NotificationItem key={n.id} n={n} now={now} layout="menu" onOpen={() => setOpen(false)} />)
        ) : (
          <NotificationEmpty title={t("emptyTitle")} text={t("emptyText")} />
        )}
      </NotificationMenu>
    </span>
  );
}
