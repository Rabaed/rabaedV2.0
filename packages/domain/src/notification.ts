import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import type { Locale } from "./locale.ts";
import { workItemOutcome } from "./work-item.ts";

/**
 * What an in-app notification is about: a Step reached the Member or their
 * pool, something happened on an item they watch, or an item was Sent Back to
 * their Participant.
 */
export const inAppNotificationKinds = ["step_reached", "watched_event", "sent_back"] as const;

/** What happened on a watched item. */
export const watchedEventTypes = ["transition", "issue_code", "revision_created", "cancelled"] as const;

/**
 * One in-app notification about an item. Its number and title, and what happened, are read
 * when it is shown, so they are only ever what the Member may see now
 * (visibility.md, "Notifications and emails").
 */
export const itemNotification = z.object({
  id: z.uuid(),
  kind: z.enum(inAppNotificationKinds),
  workItemId: z.uuid(),
  /** Null while the item has none (a Revision still in Draft). */
  documentNumber: z.string().nullable(),
  title: z.string(),
  /** A Step reached them: the Step, their own Company's. */
  step: z.object({ name: bilingualText }).nullable(),
  /**
   * Something happened on an item they watch, or it was Sent Back to them
   * (a `transition`, with no outcome): what, the Transition's label,
   * the outcome it closed the item with, and the Company that did it, by
   * name only (V14). A new Revision has no label or Company.
   */
  event: z
    .object({
      type: z.enum(watchedEventTypes),
      transition: bilingualText.nullable(),
      outcome: workItemOutcome.nullable(),
      companyName: bilingualText.nullable(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type ItemNotification = z.infer<typeof itemNotification>;

/**
 * A Package's submittals reached the Member at once (RP-643): one notification for
 * the Submit Package, instead of a "Step reached" per submittal. Its Package, and how
 * many of its submittals the Member sees now (never a total with others), are read
 * when it is shown; the Package's owner is named by its Company only (V14).
 */
export const packageNotification = z.object({
  id: z.uuid(),
  kind: z.literal("package_submitted"),
  /** None: it is about its Package (kept so every notification reads the same fields). */
  workItemId: z.null(),
  step: z.null(),
  event: z.null(),
  package: z.object({
    id: z.uuid(),
    /** PKG-001…, always left-to-right (packageNumber). */
    number: z.string(),
    name: bilingualText,
    companyName: bilingualText,
    count: z.number().int().positive(),
  }),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type PackageNotification = z.infer<typeof packageNotification>;

/** One in-app notification: about an item, or about a Package Submit. */
export const notification = z.discriminatedUnion("kind", [itemNotification, packageNotification]);
export type Notification = z.infer<typeof notification>;

/**
 * The kinds of notification that can be emailed one by one ("immediately"):
 * the in-app kinds, Sent Back included (RP-356). The weekly report is an email
 * of its own, never a notification row.
 */
export const notificationEmailKinds = ["step_reached", "watched_event", "sent_back", "package_submitted"] as const;
export type NotificationEmailKind = (typeof notificationEmailKinds)[number];

/** A Package Submit's email (RP-643): the Package, its owner's Company by name, and how many of its submittals the recipient sees. */
export interface NotificationEmailPackage {
  id: string;
  /** PKG-001…, left-to-right. */
  number: string;
  name: BilingualText;
  companyName: BilingualText;
  count: number;
}

/**
 * What one notification email says, read when it is sent as its recipient may
 * see the item then (visibility.md, "Notifications and emails"): the item's
 * Document Number and Subject, the recipient's own Step it reached them at, and
 * what happened, with another Company by name only and no person of it but the
 * signer of a final Code (V14).
 */
export interface NotificationEmailContent {
  /** Null for a Package Submit's, which is about `package`. */
  workItemId: string | null;
  /** Null while the item has none; a Package Submit's: the Package's number. */
  documentNumber: string | null;
  /** The item's Subject; a Package Submit's: the Package's name in the email's language. */
  subject: string;
  /** A Package Submit's Package (RP-643); left out for any other. */
  package?: NotificationEmailPackage;
  /** A Step reached them: the Step, their own Company's. */
  step: BilingualText | null;
  event: {
    type: (typeof watchedEventTypes)[number];
    transition: BilingualText | null;
    /** The outcome it closed the item with, such as a Review Code. */
    outcome: string | null;
    /** The Company that did it, by name only. */
    companyName: BilingualText | null;
    /** The person who issued a final Code; null for anything else. */
    signerName: BilingualText | null;
  } | null;
}

/** One notification email on its way out: to whom, in which language, about what. */
export interface NotificationEmail {
  to: string;
  /** The recipient's preferred language for email, else their locale. */
  language: Locale;
  kind: NotificationEmailKind;
  content: NotificationEmailContent;
}

/**
 * The daily email digest (RP-358): one email per Member of the notifications
 * routed "daily digest" since their last one, grouped by Project, then item,
 * each entry read when it is sent as its recipient may see it then (the same
 * checks as an immediate email). Never sent empty.
 */
export interface NotificationDigest {
  to: string;
  /** The recipient's preferred language for email, else their locale. */
  language: Locale;
  projects: NotificationDigestProject[];
}

export interface NotificationDigestProject {
  projectId: string;
  name: BilingualText;
  items: NotificationDigestItem[];
}

export interface NotificationDigestItem {
  /** Null for a Package Submit's entry, which is about `packageId`. */
  workItemId: string | null;
  /** A Package Submit's Package (RP-643); left out for an item. */
  packageId?: string;
  /** Null while the item has none; a Package's: its number. */
  documentNumber: string | null;
  /** The item's Subject, or the Package's name. */
  subject: string;
  /** What happened on it, oldest first. */
  entries: NotificationDigestEntry[];
}

/** One notification in a digest: what one immediate email would say of it. */
export interface NotificationDigestEntry {
  kind: NotificationEmailKind;
  step: NotificationEmailContent["step"];
  event: NotificationEmailContent["event"];
  /** A Package Submit's (RP-643). */
  package?: NotificationEmailPackage;
}

/** The signed-in Member's notifications, newest first, and how many are unread (the bell). */
export const notificationList = z.object({
  unread: z.number().int().nonnegative(),
  notifications: z.array(notification),
});
export type NotificationList = z.infer<typeof notificationList>;

/** Marks notifications read: those listed, or all of them when `ids` is left out. */
export const markNotificationsReadRequest = z.object({ ids: z.array(z.uuid()).max(200).optional() });
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequest>;
