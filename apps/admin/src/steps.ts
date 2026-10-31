import { randomUUID } from "node:crypto";
import type { BilingualText } from "@rabaed/domain";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import { asEngineer } from "./admin-action.ts";

// A stuck Step from Rabaed Admin (RP-1162, UAT ADM-10; workflow-engine.md §5.6, ADR 0018): a
// Rabaed Engineer finds an item by its Project and Document Number, reads its current Step and
// holder, and hands the Step to another Member of the same holding Participant's pool, or back
// to that pool. Never to another Company, never a Transition. Every read and every reassign goes
// through asEngineer with the Engineer's reason (visibility.md V9). The holding Participant's
// history reads "by Rabaed", never the Engineer; no other Company reads anything (V5, V14).

export interface StepProject {
  readonly id: string;
  readonly name: BilingualText;
  readonly code: string;
}

/** The active Projects, by name: where an Engineer looks for an item. Logged as a read. */
export function listStepProjects(adminDb: Db, engineerId: string, reason: string): Promise<StepProject[]> {
  return asEngineer(adminDb, { engineerId, action: "read_work_item_step", reason }, async (trx) => {
    const projects = await trx
      .selectFrom("project")
      .select(["id", "name", "code"])
      .where("status", "=", "active")
      .orderBy(sql`name ->> 'en'`)
      .orderBy("id")
      .execute();
    return { target: { kind: "project", id: null }, result: projects.map((p) => ({ id: p.id, name: p.name as BilingualText, code: p.code })) };
  });
}

export interface PoolMember {
  readonly memberId: string;
  readonly name: BilingualText;
  readonly email: string;
}

export interface WorkItemStep {
  readonly workItemId: string;
  readonly documentNumber: string;
  readonly title: string;
  readonly typeName: BilingualText;
  readonly closed: boolean;
  /** The open Step; null for a closed item, or one whose Step waits for a replacement Participant. */
  readonly step: {
    readonly name: BilingualText;
    readonly stageName: BilingualText | null;
    /** A Draft Step: its raiser's own, never reassigned by Rabaed. */
    readonly draft: boolean;
    readonly status: "pooled" | "picked_up";
    readonly participant: { readonly id: string; readonly companyName: BilingualText; readonly roleName: BilingualText };
    /** Null while it waits in the pool. */
    readonly holderMemberId: string | null;
    /** The holding Participant's Members who may hold it (the holder included). */
    readonly pool: PoolMember[];
  } | null;
}

/** Item `documentNumber` on Project `projectId`, with its Step and holder; null for a number the Project never issued. Logged as a read. */
export function findWorkItemStep(adminDb: Db, engineerId: string, projectId: string, documentNumber: string, reason: string): Promise<WorkItemStep | null> {
  return asEngineer(adminDb, { engineerId, action: "read_work_item_step", reason }, async (trx) => {
    const { rows } = await sql<{
      work_item_id: string;
      document_number: string;
      title: string;
      type_name: BilingualText;
      closed: boolean;
      step_name: BilingualText | null;
      stage_name: BilingualText | null;
      draft_step: boolean;
      assignment_status: "pooled" | "picked_up" | null;
      participant_id: string | null;
      company_name: BilingualText | null;
      role_name: BilingualText | null;
      holder_member_id: string | null;
      pool: { member_id: string; name: BilingualText; email: string }[];
    }>`select * from app.work_item_step_for_engineer(${projectId}::uuid, ${documentNumber})`.execute(trx);
    const r = rows[0];
    if (!r) return { target: { kind: "project", id: projectId }, after: { documentNumber, found: false }, result: null };
    const step =
      r.assignment_status && r.step_name && r.participant_id && r.company_name && r.role_name
        ? {
            name: r.step_name,
            stageName: r.stage_name,
            draft: r.draft_step,
            status: r.assignment_status,
            participant: { id: r.participant_id, companyName: r.company_name, roleName: r.role_name },
            holderMemberId: r.holder_member_id,
            pool: r.pool.map((m) => ({ memberId: m.member_id, name: m.name, email: m.email })),
          }
        : null;
    return {
      target: { kind: "work_item", id: r.work_item_id },
      after: { documentNumber: r.document_number, found: true },
      result: { workItemId: r.work_item_id, documentNumber: r.document_number, title: r.title, typeName: r.type_name, closed: r.closed, step },
    };
  });
}

/** What a reassign answers: done, or why nothing changed. */
export type ReassignStepResult =
  | "reassigned"
  | "returned_to_pool"
  | "not_found"
  | "item_closed"
  | "project_closed"
  | "no_open_step"
  | "draft_step"
  | "not_offered"
  | "already_pooled"
  | "pool_of_one";

/**
 * Hands item `workItemId`'s open Step to `toMemberId`, a Member of the holding Participant's pool,
 * or back to that pool when it is null. The admin_action names the item and keeps the reason,
 * the holder before and after; the item's event names the admin_action, never the reason.
 */
export function reassignStep(adminDb: Db, engineerId: string, workItemId: string, toMemberId: string | null, reason: string): Promise<ReassignStepResult> {
  const actionId = randomUUID();
  return asEngineer(adminDb, { engineerId, action: "reassign_step", reason, id: actionId }, async (trx) => {
    const { rows } = await sql<{ result: ReassignStepResult; from_member_id: string | null; to_member_id: string | null }>`
      select * from app.reassign_step_by_engineer(${workItemId}::uuid, ${toMemberId}::uuid, ${engineerId}::uuid, ${actionId}::uuid, now())
    `.execute(trx);
    const { result, from_member_id: from } = rows[0]!;
    return {
      target: { kind: "work_item", id: workItemId },
      before: { holderMemberId: from },
      after: { result, toMemberId },
      result,
    };
  });
}
