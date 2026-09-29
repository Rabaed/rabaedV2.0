import { Icon } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** The header bell: a link to the Member's notifications, with how many are unread. */
export async function NotificationBell({ unread }: { unread: number }) {
  const t = await getTranslations("notifications");
  const label = unread ? t("bellUnread", { count: unread }) : t("title");
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
