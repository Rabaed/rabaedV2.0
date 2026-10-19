import { withMember, type Db } from "@rabaed/db";
import type { BilingualText, Notification, NotificationList } from "@rabaed/domain";
import { sql } from "kysely";

// In-app notifications. The worker writes them (app.deliver_notification); a
// Member reads only their own bell's (RLS on notification: in-app, not
// withdrawn), and only of items they still see: RLS on notification, on
// work_item and on work_item_event, so the number, title and what happened are
// what they may see now. Another Company appears by its name only (V14).

const LIMIT = 50;

/** The Member's latest notifications and their unread count. */
export function listNotifications(db: Db, memberId: string): Promise<NotificationList> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{
      id: string;
      kind: Notification["kind"];
      work_item_id: string;
      document_number: string | null;
      title: string;
      step_name: BilingualText | null;
      event_type: NonNullable<Notification["event"]>["type"] | null;
      transition_label: BilingualText | null;
      outcome: NonNullable<Notification["event"]>["outcome"];
      company_name: BilingualText | null;
      created_at: Date;
      read_at: Date | null;
    }>`
      with latest as (
        select * from notification order by created_at desc, id desc limit ${LIMIT}
      )
      select n.id, n.kind, n.work_item_id, w.document_number, w.title, s.name as step_name,
        n.event_type, tr.label as transition_label,
        coalesce(e.payload ->> 'outcome', case when n.event_type = 'cancelled' then 'cancelled' end) as outcome,
        (select c.legal_name from app.work_item_companies(n.work_item_id) c where c.participant_id = e.actor_participant_id)
          as company_name,
        n.created_at, n.read_at
      from latest n
      join work_item w on w.id = n.work_item_id
      left join workflow_step s on s.id = n.step_id
      left join work_item_event e on e.id = n.work_item_event_id
      left join workflow_transition tr on tr.id = e.transition_id
      order by n.created_at desc, n.id desc
    `.execute(trx);
    const { rows: count } = await sql<{ unread: number }>`
      select count(*)::int as unread from notification where read_at is null
    `.execute(trx);
    return {
      unread: count[0]!.unread,
      notifications: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        workItemId: r.work_item_id,
        documentNumber: r.document_number,
        title: r.title,
        step: r.step_name ? { name: r.step_name } : null,
        event: r.event_type
          ? { type: r.event_type, transition: r.transition_label, outcome: r.outcome ?? null, companyName: r.company_name }
          : null,
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
