import { withMember, type Db } from "@rabaed/db";
import {
  defaultNotificationSettings,
  notificationGroups,
  type BilingualText,
  type Locale,
  type NotificationGroup,
  type NotificationGroupSetting,
  type NotificationSettings,
  type NotificationSettingsView,
  type UpdateNotificationSettingsRequest,
  weeklyReportSettingOf,
} from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";

// Notification settings (RP-355; spec RP-344 "Notification settings";
// design/prompts/views-dashboard-notifications.md §7). Only the Member reads and
// writes their own (RLS). A group they never set has the defaults, which
// delivery applies too (app.member_notification_route). A mute is set through
// app.set_project_mute, for a Project they are on only.

/** The signed-in Member's settings, and their Projects with each one's mute. */
export function getNotificationSettings(db: Db, memberId: string): Promise<NotificationSettingsView> {
  return withMember(db, memberId, async (trx) => {
    const { rows: groups } = await sql<{ notification_group: NotificationGroup; email: NotificationGroupSetting["email"]; outcomes: NotificationGroupSetting["outcomes"] | null }>`
      select notification_group, email, outcomes from notification_setting
    `.execute(trx);
    const settings: NotificationSettings = structuredClone(defaultNotificationSettings);
    for (const g of groups) {
      if (g.notification_group === "watched") settings.watched = { email: g.email, outcomes: g.outcomes ?? [] };
      else if (g.notification_group === "weekly_report") settings.weekly_report = weeklyReportSettingOf(g.email);
      else settings[g.notification_group] = { email: g.email };
    }
    const { rows: me } = await sql<{ email_paused: boolean | null; language: Locale; holds_assign: boolean }>`
      select p.email_paused, coalesce(p.preferred_language, m.locale) as language, app.holds_assign_permission() as holds_assign
      from member m
      left join member_notification_preference p on p.member_id = m.id
      where m.id = app.current_member_id()
    `.execute(trx);
    const { rows: projects } = await sql<{ id: string; code: string; name: BilingualText; muted: boolean }>`
      select p.id, p.code, p.name, exists (select 1 from project_mute m where m.project_id = p.id) as muted
      from project p
      where p.id in (select app.current_project_ids())
      order by p.code, p.id
    `.execute(trx);
    return {
      settings,
      emailPaused: me[0]?.email_paused ?? false,
      preferredLanguage: me[0]!.language,
      receivesWeeklyReport: me[0]!.holds_assign,
      projects,
    };
  });
}

/** Saves every setting of the signed-in Member at once. */
export function updateNotificationSettings(db: Db, memberId: string, body: UpdateNotificationSettingsRequest, now: Date): Promise<void> {
  return withMember(db, memberId, async (trx) => {
    for (const group of notificationGroups) {
      const setting: NotificationGroupSetting = body.settings[group];
      const outcomes = group === "watched" ? (setting.outcomes ?? []) : null;
      await sql`
        insert into notification_setting (member_id, notification_group, email, outcomes, updated_at)
        values (${memberId}::uuid, ${group}, ${setting.email}, ${outcomes}::text[], ${now})
        on conflict (member_id, notification_group) do update
        set email = excluded.email, outcomes = excluded.outcomes, updated_at = excluded.updated_at
      `.execute(trx);
    }
    await sql`
      insert into member_notification_preference (member_id, email_paused, preferred_language, updated_at)
      values (${memberId}::uuid, ${body.emailPaused}, ${body.preferredLanguage}, ${now})
      on conflict (member_id) do update
      set email_paused = excluded.email_paused, preferred_language = excluded.preferred_language, updated_at = excluded.updated_at
    `.execute(trx);
  });
}

/**
 * At sign-in: the browser's language becomes the language of the Member's
 * emails, the first time it is told and never after (they change it in their
 * settings).
 */
export function rememberBrowserLanguage(db: Db, memberId: string, locale: Locale, now: Date): Promise<void> {
  return withMember(db, memberId, async (trx) => {
    await sql`
      insert into member_notification_preference (member_id, preferred_language, updated_at)
      values (${memberId}::uuid, ${locale}, ${now})
      on conflict (member_id) do update
      set preferred_language = excluded.preferred_language, updated_at = excluded.updated_at
      where member_notification_preference.preferred_language is null
    `.execute(trx);
  });
}

const refusals = ["not_found"] as const;
export type MuteResult = { ok: true } | { ok: false; reason: (typeof refusals)[number] };

/** Mutes or unmutes a Project the signed-in Member is on; another is not found. */
export function setProjectMute(db: Db, memberId: string, projectId: string, muted: boolean): Promise<MuteResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.set_project_mute(${projectId}::uuid, ${muted}) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "set", refusals);
  });
}
