import { z } from "zod";
import { bilingualText } from "./company.ts";
import { workItemOutcome } from "./work-item.ts";

/**
 * What an in-app notification is about: a Step reached the Member or their
 * pool, something happened on an item they watch, an item was Sent Back to
 * their Participant, or a Step of their Company became vacant (they are its
 * Authorized Person).
 */
export const inAppNotificationKinds = ["step_reached", "watched_event", "sent_back", "vacancy"] as const;

/** What happened on a watched item. */
export const watchedEventTypes = ["transition", "issue_code", "revision_created", "cancelled"] as const;

/**
 * One in-app notification. Its number and title, and what happened, are read
 * when it is shown, so they are only ever what the Member may see now
 * (visibility.md, "Notifications and emails").
 */
export const notification = z.object({
  id: z.uuid(),
  kind: z.enum(inAppNotificationKinds),
  workItemId: z.uuid(),
  /** Null while the item has none (a Revision still in Draft). */
  documentNumber: z.string().nullable(),
  title: z.string(),
  /** A Step reached them, or became vacant: the Step, their own Company's. */
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
export type Notification = z.infer<typeof notification>;

/** The signed-in Member's notifications, newest first, and how many are unread (the bell). */
export const notificationList = z.object({
  unread: z.number().int().nonnegative(),
  notifications: z.array(notification),
});
export type NotificationList = z.infer<typeof notificationList>;

/** Marks notifications read: those listed, or all of them when `ids` is left out. */
export const markNotificationsReadRequest = z.object({ ids: z.array(z.uuid()).max(200).optional() });
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequest>;
