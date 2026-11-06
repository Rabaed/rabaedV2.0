import type { Locale } from "@rabaed/domain";
import { Icon, NotificationCard, NotificationEmpty, NotificationGroup, buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MarkNotificationsRead } from "@/components/mark-notifications-read";
import { NotificationItem } from "@/components/notification-item";
import { NotificationsToolbar } from "@/components/notifications-toolbar";
import { Link, redirect } from "@/i18n/navigation";
import { filterNotifications, groupByProject, notificationFilterOf, projectsOf } from "@/lib/notifications";
import { getMe, getNotifications } from "@/lib/session";

/**
 * The Member's notifications (RP-1153, the owner's design "Rabaed Notifications", frame 2): the
 * latest 50, newest first, Unread or All, of one Project or all, grouped by Project. Each shows
 * only what the Member may see now (its item's number and Subject, what happened with another
 * Company by name only) and opens its item, or its Package.
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notifications");
  const [me, list] = await Promise.all([getMe(), getNotifications()]);
  if (!me || !list) return redirect({ href: "/sign-in", locale });

  const filter = notificationFilterOf(await searchParams);
  const shown = filterNotifications(list.notifications, filter);
  const now = new Date();
  const rows = (items: typeof shown) => items.map((n) => <NotificationItem key={n.id} n={n} now={now} layout="page" />);
  const empty =
    filter.show === "unread" && list.notifications.length > 0 ? (
      <NotificationEmpty title={t("caughtUpTitle")} text={t("caughtUpText")} />
    ) : (
      <NotificationEmpty title={t("emptyTitle")} text={t("emptyText")} />
    );

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[24px] font-bold tracking-[-0.01em] max-[559px]:text-[22px]">{t("title")}</h1>
          <p className="mt-1 mb-0 text-[13.5px] text-muted">{t("subtitle", { name: me.member.fullName[locale], company: me.company.legalName[locale] })}</p>
        </div>
        <MarkNotificationsRead unread={list.unread} />
        <Link href="/profile#notification-settings" className={buttonVariants({ variant: "ghost" })}>
          <Icon name="settings" />
          {t("settings")}
        </Link>
      </div>
      <NotificationsToolbar filter={filter} unread={list.unread} projects={projectsOf(list.notifications)} />
      <div data-testid="notification-list" className="flex flex-col gap-4">
        {shown.length === 0 ? (
          <NotificationCard>{empty}</NotificationCard>
        ) : filter.group ? (
          groupByProject(shown).map((g) => (
            <NotificationGroup key={g.project.id} code={g.project.code} name={g.project.name[locale]} count={g.notifications.length}>
              {rows(g.notifications)}
            </NotificationGroup>
          ))
        ) : (
          <NotificationCard>{rows(shown)}</NotificationCard>
        )}
      </div>
    </div>
  );
}
