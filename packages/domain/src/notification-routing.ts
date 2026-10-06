import { z } from "zod";
import { bilingualText } from "./company.ts";
import { locales } from "./locale.ts";

// Notification settings and the routing rule (spec RP-344, "Notifications" and
// "Notification settings"; RP-355; design/prompts/views-dashboard-notifications.md §7).
// The database applies the same rule at delivery (app.notification_route); a
// seam-2 test checks the two agree on every combination.

/** What a notification is about. `weekly_report` is the weekly Step Age report, an email only. */
export const notificationKinds = ["step_reached", "watched_event", "sent_back", "vacancy", "weekly_report"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/** The rows of the settings page: Step reached me or my pool · Items I watch · Sent Back to my Participant · Vacancy in my Company · Weekly Step Age report. */
export const notificationGroups = ["step_reached", "watched", "sent_back", "vacancy", "weekly_report"] as const;
export type NotificationGroup = (typeof notificationGroups)[number];

const groupOfKind = {
  step_reached: "step_reached",
  watched_event: "watched",
  sent_back: "sent_back",
  vacancy: "vacancy",
  weekly_report: "weekly_report",
} as const satisfies Record<NotificationKind, NotificationGroup>;

/** The settings group a kind of notification follows. */
export function notificationGroupOf(kind: NotificationKind): NotificationGroup {
  return groupOfKind[kind];
}

/** A group's email: off, immediately, or in the daily digest. */
export const notificationEmailChoices = ["off", "immediate", "digest"] as const;
export type NotificationEmailChoice = (typeof notificationEmailChoices)[number];

/** How one notification is emailed, once routed. */
export const routedEmails = ["none", "immediate", "digest"] as const;
export type RoutedEmail = (typeof routedEmails)[number];

/**
 * The outcomes a watcher can tick: the Review Codes; the Inspection Results;
 * and Approved, Rejected (for Types with neither) and Cancelled. Any other
 * outcome (such as a Snag's plain "closed") always notifies.
 */
export const watchOutcomes = ["A", "B", "C", "D", "passed", "passed_with_comments", "failed", "approved", "rejected", "cancelled"] as const;
export type WatchOutcome = (typeof watchOutcomes)[number];

export const notificationGroupSetting = z.object({
  inApp: z.boolean(),
  email: z.enum(notificationEmailChoices),
  /** "Items I watch" only: the outcomes that notify. */
  outcomes: z.array(z.enum(watchOutcomes)).optional(),
});
export type NotificationGroupSetting = z.infer<typeof notificationGroupSetting>;

export const notificationSettings = z.object({
  step_reached: notificationGroupSetting,
  watched: notificationGroupSetting.required({ outcomes: true }),
  sent_back: notificationGroupSetting,
  vacancy: notificationGroupSetting,
  weekly_report: notificationGroupSetting,
});
export type NotificationSettings = z.infer<typeof notificationSettings>;

/** In-app on; email immediately for Step reached and Sent Back, a digest for the rest; every outcome ticked. */
export const defaultNotificationSettings: NotificationSettings = {
  step_reached: { inApp: true, email: "immediate" },
  watched: { inApp: true, email: "digest", outcomes: [...watchOutcomes] },
  sent_back: { inApp: true, email: "immediate" },
  vacancy: { inApp: true, email: "digest" },
  weekly_report: { inApp: true, email: "digest" },
};

export interface RouteNotificationInput {
  kind: NotificationKind;
  /** The outcome the event closed the item with, or null for one that closed nothing. */
  outcome: string | null;
  /** The recipient's settings. */
  settings: NotificationSettings;
  /** The recipient muted the item's Project. */
  muted: boolean;
  /** The recipient paused all email. */
  emailPaused: boolean;
}

export interface NotificationRoute {
  /** It reaches the bell. */
  inApp: boolean;
  email: RoutedEmail;
}

const silent: NotificationRoute = { inApp: false, email: "none" };

/**
 * For one recipient of one event: whether it reaches their bell, and how it is
 * emailed. A muted Project, or an outcome a watcher didn't tick, silences both;
 * pausing email stops only the email. Need My Action never passes through here.
 */
export function routeNotification({ kind, outcome, settings, muted, emailPaused }: RouteNotificationInput): NotificationRoute {
  const setting = settings[notificationGroupOf(kind)];
  if (muted) return silent;
  if (kind === "watched_event" && isWatchOutcome(outcome) && !(setting.outcomes ?? watchOutcomes).includes(outcome)) return silent;
  return { inApp: setting.inApp, email: emailPaused || setting.email === "off" ? "none" : setting.email };
}

function isWatchOutcome(outcome: string | null): outcome is WatchOutcome {
  return outcome !== null && (watchOutcomes as readonly string[]).includes(outcome);
}

/** GET /v1/notification-settings: the signed-in Member's settings, and their Projects with each one's mute. */
export const notificationSettingsView = z.object({
  settings: notificationSettings,
  emailPaused: z.boolean(),
  /** The language of their emails. */
  preferredLanguage: z.enum(locales),
  /** Whether the Weekly Step Age report row applies to them (they hold Assign on a Project). */
  receivesWeeklyReport: z.boolean(),
  projects: z.array(z.object({ id: z.uuid(), code: z.string(), name: bilingualText, muted: z.boolean() })),
});
export type NotificationSettingsView = z.infer<typeof notificationSettingsView>;

/** PUT /v1/notification-settings: every setting at once. */
export const updateNotificationSettingsRequest = z.object({
  settings: notificationSettings,
  emailPaused: z.boolean(),
  preferredLanguage: z.enum(locales),
});
export type UpdateNotificationSettingsRequest = z.infer<typeof updateNotificationSettingsRequest>;
