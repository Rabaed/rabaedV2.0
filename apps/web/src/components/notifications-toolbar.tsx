"use client";

import type { Locale, NotificationProject } from "@rabaed/domain";
import { SegmentedControl, Select, Switch } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { useRouter } from "@/i18n/navigation";
import { notificationQuery, type NotificationFilter } from "@/lib/notifications";

const ALL = "all";

/**
 * The Notifications page's filters (RP-1153, the design's `.ntb`): Unread (with its count) or
 * All, one Project or every one, and Group by Project. Each is kept in the URL, so the back
 * button and the bell's View all keep it. On a phone the switch is left out and the list stays grouped.
 */
export function NotificationsToolbar({ filter, unread, projects }: { filter: NotificationFilter; unread: number; projects: NotificationProject[] }) {
  const t = useTranslations("notifications");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const groupId = useId();
  const go = (next: Partial<NotificationFilter>) => router.replace(`/notifications${notificationQuery({ ...filter, ...next })}`, { scroll: false });

  return (
    <div className="flex flex-wrap items-center gap-2.5 max-[559px]:gap-2">
      <SegmentedControl
        aria-label={t("show")}
        className="max-[559px]:w-full max-[559px]:[&>button]:flex-1"
        value={filter.show}
        onValueChange={(show) => go({ show: show === "all" ? "all" : "unread" })}
        options={[
          {
            value: "unread",
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t("unread")}
                {unread > 0 && (
                  <em className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-on-primary not-italic">
                    <bdi dir="ltr">{unread}</bdi>
                  </em>
                )}
              </span>
            ),
          },
          { value: "all", label: t("all") },
        ]}
      />
      <span className="flex-1 max-[559px]:hidden" />
      <Select
        aria-label={t("project")}
        className="w-60 max-[559px]:w-full"
        value={filter.project ?? ALL}
        onValueChange={(project) => go({ project: project === ALL ? null : project })}
        options={[
          { value: ALL, label: t("allProjects") },
          ...projects.map((p) => ({ value: p.id, label: t("projectOption", { name: p.name[locale], code: p.code }) })),
        ]}
      />
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-text-secondary max-[559px]:hidden">
        <Switch id={groupId} checked={filter.group} onCheckedChange={(group) => go({ group })} />
        <label htmlFor={groupId}>{t("group")}</label>
      </span>
    </div>
  );
}
