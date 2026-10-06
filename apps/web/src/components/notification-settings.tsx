"use client";

import type { Locale, NotificationSettingsView } from "@rabaed/domain";
import { NotificationSettingsForm, type SettingsCall } from "@rabaed/ui";

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
  return (
    <NotificationSettingsForm
      locale={locale}
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
