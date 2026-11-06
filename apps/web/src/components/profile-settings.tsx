"use client";

import type { Locale, NotificationSettingsView, SignedInMember } from "@rabaed/domain";
import { ProfileSettings as ProfileSettingsView, type ProfileSettingsLabels, type SettingsCall } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/** The API's answer to a save: ok, or the refusal's error code. */
async function result(res: Response): ReturnType<SettingsCall> {
  if (res.ok) return { ok: true };
  const { error } = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, reason: error ?? "unavailable" };
}

/**
 * The signed-in Member's profile and notification settings (RP-1154; RP-355): every change is
 * saved at once with PUT /v1/notification-settings; a Project's mute with PUT or DELETE on its /mute.
 */
export function ProfileSettings({
  me,
  value,
  locale,
  signature,
}: {
  me: SignedInMember;
  value: NotificationSettingsView;
  locale: Locale;
  signature: ReactNode;
}) {
  const t = useTranslations("notificationSettings");
  const labels: ProfileSettingsLabels = {
    title: t("title"),
    subtitle: t("subtitle"),
    saveIdle: t("saveIdle"),
    saved: t("saved"),
    profile: t("profile"),
    email: t("email"),
    company: t("company"),
    positions: t("positions"),
    lock: t("lock"),
    language: t("language"),
    signature: t("signature"),
    notifications: t("notifications"),
    inAppLine: t("inAppLine"),
    pauseAll: t("pauseAll"),
    pauseHelp: t("pauseHelp"),
    pausedHelp: t("pausedHelp"),
    projects: t("projects"),
    mute: t("mute"),
    unmuted: t("unmuted"),
    muted: t("muted"),
    noProjects: t("noProjects"),
    whatToEmail: t("whatToEmail"),
    groupColumn: t("groupColumn"),
    emailColumn: t("emailColumn"),
    emailChoice: { off: t("emailChoice.off"), immediate: t("emailChoice.immediate"), digest: t("emailChoice.digest") },
    group: {
      step_reached: t("group.step_reached"),
      watched: t("group.watched"),
      sent_back: t("group.sent_back"),
      weekly_report: t("group.weekly_report"),
    },
    groupHelp: {
      step_reached: t("groupHelp.step_reached"),
      sent_back: t("groupHelp.sent_back"),
      weekly_report: t("groupHelp.weekly_report"),
    },
    // The kit fills in the counts as they change.
    outcomesTicked: t("outcomesTicked", { ticked: "{ticked}", total: "{total}" }),
    outcomeGroups: { review_code: t("outcomeGroups.review_code"), inspection_result: t("outcomeGroups.inspection_result"), other: t("outcomeGroups.other") },
    digestLine: t("digestLine"),
    refusals: { not_found: t("refusals.not_found"), unavailable: t("refusals.unavailable") },
  };
  return (
    <ProfileSettingsView
      locale={locale}
      labels={labels}
      member={{ id: me.member.id, name: me.member.fullName, email: me.member.email, companyName: me.company.legalName }}
      value={value}
      signature={signature}
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
