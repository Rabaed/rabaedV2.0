import { notificationPackageOf, withMember, type Db, type NotificationPackageColumns } from "@rabaed/db";
import {
  defaultOutcomeSets,
  type BilingualText,
  type ItemNotification,
  type Notification,
  type NotificationList,
  type NotificationOutcomeKind,
  type OutcomeKind,
} from "@rabaed/domain";
import { sql } from "kysely";

// In-app notifications. The worker writes them (app.deliver_notification); a
// Member reads only their own bell's (RLS on notification: in-app, not
// withdrawn), and only of items they still see: RLS on notification, on
// work_item and on work_item_event, so the number, title and what happened are
// what they may see now. Another Company appears by its name only (V14). A
// Package Submit's (RP-643) names its Package, and counts only the submittals the
// Member sees now, through app.notification_package; it is shown only while
// that is at least one.
//
// RP-1153 adds, each through the same RLS: the Project (the Member's own, project
// RLS), whether a "Step reached" came to their Step Pool and still waits there
// (app.notification_pools: two booleans, no time), the outcome's name from the item's Type's set (read like the
// Type), the item's Revision number, and whether the Company named is their own.

const LIMIT = 50;

const inspectionResults = new Set(defaultOutcomeSets.inspection_result.map((o) => o.code));

/** How the bell words an event's outcome: as a Code its Step issued, as an Inspection Result, or by its Transition. */
function outcomeKindOf(eventType: string | null, typeKind: OutcomeKind | null, outcome: string | null): NotificationOutcomeKind | null {
  if (!outcome) return null;
  if (typeKind === "review_code" && eventType === "issue_code") return "review_code";
  // A WIR on Workflow Version 1 or 2 ends with an Inspection Result though its Type issues Codes (RP-673).
  if (typeKind === "inspection_result" || (typeKind === "review_code" && inspectionResults.has(outcome))) return "inspection_result";
  return null;
}

/** The Member's latest notifications and their unread count. */
export function listNotifications(db: Db, memberId: string): Promise<NotificationList> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{
      id: string;
      kind: Notification["kind"];
      work_item_id: string | null;
      document_number: string | null;
      title: string | null;
      revision_no: number | null;
      project_id: string;
      project_code: string;
      project_name: BilingualText;
      step_name: BilingualText | null;
      pool: boolean | null;
      pool_waiting: boolean | null;
      event_type: NonNullable<ItemNotification["event"]>["type"] | null;
      transition_label: BilingualText | null;
      outcome: NonNullable<ItemNotification["event"]>["outcome"];
      outcome_name: BilingualText | null;
      type_outcome_kind: OutcomeKind | null;
      company_name: BilingualText | null;
      own_company: boolean | null;
      created_at: Date;
      read_at: Date | null;
    } & NotificationPackageColumns>`
      with latest as (
        select * from notification order by created_at desc, id desc limit ${LIMIT}
      )
      select n.id, n.kind, n.work_item_id, w.document_number, w.title, w.revision_no,
        p.id as project_id, p.code as project_code, p.name as project_name,
        s.name as step_name,
        sp.pool, sp.waiting as pool_waiting,
        n.event_type, tr.label as transition_label,
        coalesce(e.payload ->> 'outcome', case when n.event_type = 'cancelled' then 'cancelled' end) as outcome,
        o.name as outcome_name, wt.outcome_kind as type_outcome_kind,
        (select c.legal_name from app.work_item_companies(n.work_item_id) c where c.participant_id = nm.participant_id)
          as company_name,
        nm.participant_id in (select app.current_participant_ids()) as own_company,
        k.package_id, k.seq as package_seq, k.name as package_name, k.company_name as package_company_name, k.item_count,
        n.created_at, n.read_at
      from latest n
      join project p on p.id = n.project_id
      left join work_item w on w.id = n.work_item_id
      left join work_item_type wt on wt.id = w.work_item_type_id
      left join workflow_step s on s.id = n.step_id
      -- Whether a "Step reached" came to their Step Pool, and still waits there: booleans only, no time (RP-1153).
      left join app.notification_pools(array(select l.id from latest l where l.kind = 'step_reached')) sp on sp.notification_id = n.id
      left join work_item_event e on e.id = n.work_item_event_id
      -- Who the event names: its actor's Participant; a new Revision's (its event is read by nobody), its raiser's.
      cross join lateral (
        select case when n.event_type = 'revision_created' then w.raised_by_participant_id else e.actor_participant_id end as participant_id
      ) nm
      left join outcome o on o.project_id = n.project_id and o.work_item_type_id = w.work_item_type_id
        and o.code = e.payload ->> 'outcome'
      -- The Transition's label, which everyone who reads the event is shown; its id is the actor's own (RP-1140).
      left join app.event_transitions(array(select l.work_item_event_id from latest l where l.work_item_event_id is not null)) tr
        on tr.event_id = e.id
      left join lateral app.notification_package(n.id) k on n.package_id is not null
      order by n.created_at desc, n.id desc
    `.execute(trx);
    const { rows: count } = await sql<{ unread: number }>`
      select count(*)::int as unread from notification where read_at is null
    `.execute(trx);
    return {
      unread: count[0]!.unread,
      notifications: rows.map((r): Notification => {
        const common = {
          id: r.id,
          project: { id: r.project_id, code: r.project_code, name: r.project_name },
          createdAt: r.created_at.toISOString(),
          readAt: r.read_at?.toISOString() ?? null,
        };
        if (r.kind === "package_submitted") {
          return {
            ...common,
            kind: r.kind,
            workItemId: null,
            step: null,
            pool: null,
            event: null,
            package: notificationPackageOf(r)!,
          };
        }
        return {
          ...common,
          kind: r.kind,
          workItemId: r.work_item_id!,
          documentNumber: r.document_number,
          title: r.title!,
          revisionNo: r.revision_no ?? 0,
          step: r.step_name ? { name: r.step_name } : null,
          pool: r.pool ? { waiting: r.pool_waiting === true } : null,
          event: r.event_type
            ? {
                type: r.event_type,
                transition: r.transition_label,
                outcome: r.outcome ?? null,
                outcomeName: r.outcome_name,
                outcomeKind: outcomeKindOf(r.event_type, r.type_outcome_kind, r.outcome),
                companyName: r.company_name,
                ownCompany: r.own_company === true,
              }
            : null,
        };
      }),
    };
  });
}

/** Marks the Member's notifications read: `ids`, or all when undefined. */
export function markNotificationsRead(db: Db, memberId: string, ids: string[] | undefined, now: Date): Promise<void> {
  return withMember(db, memberId, async (trx) => {
    await sql`select app.mark_notifications_read(${ids ?? null}::uuid[], ${now})`.execute(trx);
  });
}
