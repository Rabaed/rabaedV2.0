import { z } from "zod";
import { bilingualText } from "./company.ts";

/**
 * One in-app notification: a Work Item reached the Member at a Step. Its number
 * and title are read when it is shown, so they are only ever what the Member
 * may see now (visibility.md, "Notifications and emails").
 */
export const notification = z.object({
  id: z.uuid(),
  workItemId: z.uuid(),
  /** Null while the item has none (never for a notification today: items leave Draft first). */
  documentNumber: z.string().nullable(),
  title: z.string(),
  /** The Step it reached them at: their own Company's. */
  step: z.object({ name: bilingualText }),
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
