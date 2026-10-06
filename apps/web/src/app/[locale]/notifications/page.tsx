import type { Locale } from "@rabaed/domain";
import { DocNo } from "@rabaed/ui";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { MarkNotificationsRead } from "@/components/mark-notifications-read";
import { NotificationLink } from "@/components/notification-link";
import { redirect } from "@/i18n/navigation";
import { getMe, getNotifications } from "@/lib/session";

/**
 * The Member's notifications, newest first. Each shows only the item's number
 * and title as the Member may see them now, and links to the item.
 */
export default async function NotificationsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const [me, list] = await Promise.all([getMe(), getNotifications()]);
  if (!me || !list) return redirect({ href: "/sign-in", locale });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        {list.unread > 0 && <MarkNotificationsRead />}
      </div>
      {list.notifications.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="notification-list">
          {list.notifications.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-4 py-3">
              <div className="space-y-1">
                <NotificationLink id={n.id} href={`/work-items/${n.workItemId}`} unread={!n.readAt}>
                  {n.title}
                </NotificationLink>
                <p className="text-sm text-muted">
                  {n.documentNumber && (
                    <>
                      <DocNo value={n.documentNumber} />
                      {" · "}
                    </>
                  )}
                  {n.step && t("reached", { step: n.step.name[locale] })}
                  {n.event &&
                    (n.event.type === "revision_created"
                      ? t("revisionCreated")
                      : [n.event.companyName?.[locale], n.event.transition?.[locale] ?? t("cancelled")].filter(Boolean).join(" · "))}
                </p>
              </div>
              <div className="shrink-0 text-end text-sm text-muted">
                <time dateTime={n.createdAt}>
                  {format.dateTime(new Date(n.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Riyadh",
                    numberingSystem: "latn",
                  })}
                </time>
                {!n.readAt && <p className="font-semibold text-primary">{t("unread")}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
