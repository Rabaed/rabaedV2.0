import { formatDate, riyadhDay, type Locale, type Notification, type NotificationProject } from "@rabaed/domain";
import type { IconName, NotificationTone } from "@rabaed/ui";

// How the bell and the Notifications page show a notification (RP-1153, the owner's
// design D:\Artifacts\Rabaed Notifications.html): what happened, as a message key and
// its values (in the page's language; another Company by its name only, V14), the
// icon and tone of its kind, a short time, and the Unread / All, Project and
// Group by Project filters, kept in the URL.

/** A message of `notifications.what` (or `.time`) and its values: numbers as Latin-digit text, but a plural's `count`. */
export type WhatHappened = { key: string; values: Record<string, string | number> };

const isCancel = (e: NonNullable<Notification["event"]>) => e.type === "cancelled" || e.outcome === "cancelled";

/** What happened, in `locale`: a message key of `notifications.what` and its values. */
export function whatHappened(n: Notification, locale: Locale): WhatHappened {
  if (n.kind === "package_submitted") return { key: "packageSubmitted", values: { company: n.package.companyName[locale], count: n.package.count, n: String(n.package.count) } };
  // The Host Company that withdrew the Member's Company (RP-952), never the person.
  if (n.kind === "participant_withdrawn") return { key: "participantWithdrawn", values: { company: n.hostCompany.legalName[locale] } };
  if (n.kind === "record_ready") return { key: "recordReady", values: {} };
  if (n.kind === "step_reached") return { key: n.pool ? "reachedPool" : "reached", values: { step: n.step?.name[locale] ?? "" } };
  const e = n.event;
  const company = e?.companyName?.[locale] ?? "";
  if (n.kind === "sent_back") return { key: "sentBack", values: { company } };
  if (!e) return { key: "transition", values: { transition: "" } };
  if (e.type === "revision_created") return e.ownCompany || !company ? { key: "revision", values: { n: String(n.revisionNo) } } : { key: "revisionFrom", values: { company, n: String(n.revisionNo) } };
  if (isCancel(e)) return e.ownCompany || !company ? { key: "cancelled", values: {} } : { key: "cancelledBy", values: { company } };
  if (e.outcomeKind === "review_code" && e.outcome) {
    const code = { code: e.outcome, name: e.outcomeName?.[locale] ?? "" };
    return company ? { key: "reviewCode", values: { ...code, company } } : { key: "reviewCodeOnly", values: code };
  }
  if (e.outcomeKind === "inspection_result") return { key: "inspectionResult", values: { name: e.outcomeName?.[locale] ?? e.outcome ?? "" } };
  const transition = e.transition?.[locale] ?? "";
  return company ? { key: "transitionBy", values: { transition, company } } : { key: "transition", values: { transition } };
}

/** The icon and tone of a notification's kind. */
export function notificationLook(n: Notification): { icon: IconName; tone: NotificationTone } {
  if (n.kind === "package_submitted") return { icon: "package", tone: "info" };
  if (n.kind === "participant_withdrawn") return { icon: "circle-x", tone: "neutral" };
  if (n.kind === "record_ready") return { icon: "file-download", tone: "success" };
  // eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon names, not copy
  if (n.kind === "step_reached") return n.pool ? { icon: "users", tone: "brand" } : { icon: "user-check", tone: "brand" };
  if (n.kind === "sent_back") return { icon: "arrow-back-up", tone: "danger" };
  const e = n.event;
  if (e?.type === "revision_created") return { icon: "git-branch", tone: "violet" };
  if (e && isCancel(e)) return { icon: "circle-x", tone: "neutral" };
  if (e?.outcomeKind === "review_code") return { icon: "gavel", tone: "warning" };
  if (e?.outcomeKind === "inspection_result") return { icon: "clipboard-check", tone: "success" };
  return { icon: "send", tone: "info" };
}

/** Where a notification opens: its item, its Package, or (a withdrawal, whose Project the Member no longer sees) their Company's Projects. */
export const notificationHref = (n: Notification): string =>
  n.kind === "package_submitted" ? `/packages/${n.package.id}` : n.kind === "participant_withdrawn" ? "/participants" : `/work-items/${n.workItemId}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * How long ago, short: "5 min" under an hour, "2 h" within a day, "Yesterday 10:10"
 * on the Riyadh day before, else "28 Oct", with the year when it isn't this one.
 * A message key of `notifications.time` and its values; Latin digits in both languages.
 */
export function timeLabel(at: Date, now: Date, locale: Locale): WhatHappened {
  const ago = now.getTime() - at.getTime();
  if (ago < HOUR) return { key: "minutes", values: { n: String(Math.max(1, Math.floor(ago / MINUTE))) } };
  if (ago < 24 * HOUR && riyadhDay(at) === riyadhDay(now)) return { key: "hours", values: { n: String(Math.floor(ago / HOUR)) } };
  const yesterday = new Date(now.getTime() - 24 * HOUR);
  if (riyadhDay(at) === riyadhDay(yesterday)) {
    const time = formatDate(at, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return { key: "yesterday", values: { time } };
  }
  const sameYear = riyadhDay(at).slice(0, 4) === riyadhDay(now).slice(0, 4);
  // Day, then month, as the design writes it in both languages ("28 Oct"), whatever order the locale has.
  const parts = [formatDate(at, locale, { day: "numeric" }), formatDate(at, locale, { month: "short" }), ...(sameYear ? [] : [formatDate(at, locale, { year: "numeric" })])];
  const date = parts.join(" ");
  return { key: "date", values: { date } };
}

/** The Notifications page's filters: Unread or All, one Project or every one, grouped by Project or not. */
export type NotificationFilter = { show: "unread" | "all"; project: string | null; group: boolean };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The filters in the page's URL: Unread, every Project and grouped, at first. */
export function notificationFilterOf(params: Record<string, string | string[] | undefined>): NotificationFilter {
  return { show: first(params.show) === "all" ? "all" : "unread", project: first(params.project) || null, group: first(params.group) !== "off" };
}

/** The URL query of `filter`, leaving out what is as at first ("" when all is). */
export function notificationQuery(filter: NotificationFilter): string {
  const q = new URLSearchParams();
  if (filter.show === "all") q.set("show", "all");
  if (filter.project) q.set("project", filter.project);
  if (!filter.group) q.set("group", "off");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The notifications `filter` keeps, in their order. */
export const filterNotifications = (list: Notification[], filter: NotificationFilter): Notification[] =>
  list.filter((n) => (filter.show === "all" || !n.readAt) && (!filter.project || n.project.id === filter.project));

/** Each Project of `list` once, in the order its newest notification comes. */
export function projectsOf(list: Notification[]): NotificationProject[] {
  const seen = new Map<string, NotificationProject>();
  for (const n of list) if (!seen.has(n.project.id)) seen.set(n.project.id, n.project);
  return [...seen.values()];
}

/** `list` grouped by Project, in projectsOf's order, each group in the list's order. */
export const groupByProject = (list: Notification[]): { project: NotificationProject; notifications: Notification[] }[] =>
  projectsOf(list).map((project) => ({ project, notifications: list.filter((n) => n.project.id === project.id) }));
