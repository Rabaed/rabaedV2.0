"use client";

import type { Locale, NotificationSettingsView } from "@rabaed/domain";
import { NotificationSettingsForm, type NotificationSettingsLabels, type SettingsCall } from "@rabaed/ui";
import { useTranslations } from "next-intl";

/** The API's answer to a save: ok, or the refusal's error code. */
async function result(res: Response): ReturnType<SettingsCall> {
  if (res.ok) return { ok: true };
  const { error } = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, reason: error ?? "unavailable" };
}

/**
 * The signed-in Member's notification settings (RP-355): every change is saved
 * at once with PUT /v1/notification-settings; a Project's mute with PUT or
 * DELETE on its /mute.
 */
export function NotificationSettings({ value, locale }: { value: NotificationSettingsView; locale: Locale }) {
  const t = useTranslations("notificationSettings");
  const labels: NotificationSettingsLabels = {
    email: t("email"),
    pauseAll: t("pauseAll"),
    pauseHelp: t("pauseHelp"),
    language: t("language"),
    projects: t("projects"),
    projectsHelp: t("projectsHelp"),
    mute: t("mute"),
    noProjects: t("noProjects"),
    groups: t("groups"),
    emailChoice: { off: t("emailChoice.off"), immediate: t("emailChoice.immediate"), digest: t("emailChoice.digest") },
    group: {
      step_reached: t("group.step_reached"),
      watched: t("group.watched"),
      sent_back: t("group.sent_back"),
      weekly_report: t("group.weekly_report"),
    },
    weeklyHelp: t("weeklyHelp"),
    outcomes: t("outcomes"),
    outcomeGroups: { review_code: t("outcomeGroups.review_code"), inspection_result: t("outcomeGroups.inspection_result"), other: t("outcomeGroups.other") },
    refusals: { not_found: t("refusals.not_found"), unavailable: t("refusals.unavailable") },
  };
  return (
    <NotificationSettingsForm
      locale={locale}
      labels={labels}
      value={value}
      onSave={async (settings) =>
        result(
          await fetch("/api/v1/notification-settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(settings),
          }),
        )
      }
      onMute={async (projectId, muted) =>
        result(await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/mute`, { method: muted ? "PUT" : "DELETE" }))
      }
    />
  );
}
