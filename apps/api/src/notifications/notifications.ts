import { withMember, type Db } from "@rabaed/db";
import type { BilingualText, NotificationList } from "@rabaed/domain";
import { sql } from "kysely";

// In-app notifications. The worker writes them (app.deliver_notification); a
// Member reads only their own, and only of items they still see: RLS on
// notification and on work_item, so the number and title are what they may see.

const LIMIT = 50;

/** The Member's latest notifications and their unread count. */
export function listNotifications(db: Db, memberId: string): Promise<NotificationList> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{
      id: string;
      work_item_id: string;
      document_number: string | null;
      title: string;
      step_name: BilingualText;
      created_at: Date;
      read_at: Date | null;
    }>`
      select n.id, n.work_item_id, w.document_number, w.title, s.name as step_name, n.created_at, n.read_at
      from notification n
      join work_item w on w.id = n.work_item_id
      join workflow_step s on s.id = n.step_id
      order by n.created_at desc, n.id desc
      limit ${LIMIT}
    `.execute(trx);
    const { rows: count } = await sql<{ unread: number }>`
      select count(*)::int as unread from notification where read_at is null
    `.execute(trx);
    return {
      unread: count[0]!.unread,
      notifications: rows.map((r) => ({
        id: r.id,
        workItemId: r.work_item_id,
        documentNumber: r.document_number,
        title: r.title,
        step: { name: r.step_name },
        createdAt: r.created_at.toISOString(),
        readAt: r.read_at?.toISOString() ?? null,
      })),
    };
  });
}

/** Marks the Member's notifications read: `ids`, or all when undefined. */
export function markNotificationsRead(db: Db, memberId: string, ids: string[] | undefined, now: Date): Promise<void> {
  return withMember(db, memberId, async (trx) => {
    await sql`select app.mark_notifications_read(${ids ?? null}::uuid[], ${now})`.execute(trx);
  });
}
