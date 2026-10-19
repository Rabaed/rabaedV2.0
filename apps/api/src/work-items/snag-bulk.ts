import { createHash } from "node:crypto";
import { withMember, type Db } from "@rabaed/db";
import type {
  BilingualText,
  SnagBulkCandidates,
  SnagBulkMoveRequest,
  SnagBulkReassignRequest,
  SnagBulkResult,
  SnagBulkSkipReason,
} from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome } from "../outcomes.ts";
import type { FileStore } from "../documents/file-store.ts";
import { takeTransition } from "./work-items.ts";

// The Snag List's bulk actions (RP-629, spec RP-619). Each acts item by item through the
// same database commands as the single-item action, in the viewer's own name, so nothing
// is allowed here that the item's page would not allow, and an item the viewer may not
// act on is skipped and named (never the whole request refused). Items the viewer does not
// see are `not_found` and carry no name (V3).

type Skipped = SnagBulkResult["skipped"][number];

/** What the viewer may read of an item they see: its Document Number and Subject, its Stage as seen (V14). */
async function visibleItem(db: Db, memberId: string, projectId: string, id: string) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ document_number: string | null; title: string; stage_key: string }>`
      select w.document_number, w.title, seen.stage_key
      from work_item w
      cross join lateral app.step_as_seen(w.id) seen
      where w.id = ${id} and w.project_id = ${projectId} and app.sees_work_item(w.id)
    `.execute(trx);
    return rows[0] ?? null;
  });
}

const skip = (id: string, item: { document_number: string | null; title: string } | null, reason: SnagBulkSkipReason): Skipped => ({
  id,
  documentNumber: item?.document_number ?? null,
  title: item?.title ?? null,
  reason,
});

/** A key of the request's, per item: the same request again applies once. */
function itemKey(requestKey: string, id: string): string {
  const hex = createHash("sha256").update(`${requestKey}/${id}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Whether the viewer is a Member of the Project (a Project they are not on is the plain 404). */
export function onProject(db: Db, memberId: string, projectId: string): Promise<boolean> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`select exists (select 1 from project where id = ${projectId}) as ok`.execute(trx);
    return rows[0]!.ok;
  });
}

/**
 * Move Stage: for each chosen item, the Transition the viewer is offered whose next Step is at
 * `stage`, taken and confirmed as in its pop-up. One that asks for an Action Form (a Resolve's note)
 * is not taken here: the item is skipped as `needs_input`.
 */
export async function bulkMove(db: Db, files: FileStore, memberId: string, projectId: string, request: SnagBulkMoveRequest, now: Date): Promise<SnagBulkResult> {
  const result: SnagBulkResult = { done: [], skipped: [] };
  for (const id of [...new Set(request.ids)]) {
    const item = await visibleItem(db, memberId, projectId, id);
    if (!item) {
      result.skipped.push(skip(id, null, "not_found"));
      continue;
    }
    if (item.stage_key === request.stage) {
      result.skipped.push(skip(id, item, "already_there"));
      continue;
    }
    const offered = await withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ transition_key: string; has_form: boolean }>`
        select a.transition_key, tr.action_form is not null as has_form
        from app.work_item_actions(${id}::uuid) a
        join work_item w on w.id = ${id}::uuid
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
        join workflow_step ts on ts.id = tr.to_step_id
        where a.action = 'transition' and ts.stage_key = ${request.stage}
        order by a.transition_key
      `.execute(trx);
      return rows;
    });
    if (offered.length === 0) {
      result.skipped.push(skip(id, item, "not_offered"));
      continue;
    }
    const plain = offered.filter((o) => !o.has_form);
    if (plain.length !== 1) {
      result.skipped.push(skip(id, item, "needs_input"));
      continue;
    }
    const taken = await takeTransition(
      db,
      files,
      memberId,
      id,
      {
        transition: plain[0]!.transition_key,
        answers: {},
        internalNote: "",
        assignTo: null,
        recommendedCode: null,
        confirmed: true,
        idempotencyKey: itemKey(request.idempotencyKey, id),
      },
      now,
    );
    if (taken.ok) result.done.push(id);
    else result.skipped.push(skip(id, item, taken.reason === "not_found" ? "not_found" : "refused"));
  }
  return result;
}

/**
 * The Members of the viewer's own Participant who could take at least one of the chosen items, with how
 * many, and how many of the items the viewer may reassign at all (app.reassign_candidates: the items their
 * Participant holds, at a Step they hold or may pick up). Never another Company's Member.
 */
export async function reassignCandidates(db: Db, memberId: string, projectId: string, ids: readonly string[]): Promise<SnagBulkCandidates> {
  return withMember(db, memberId, async (trx) => {
    let reassignable = 0;
    const members = new Map<string, { name: BilingualText; items: number }>();
    for (const id of new Set(ids)) {
      const { rows } = await sql<{ member_id: string; full_name: BilingualText }>`
        select c.member_id, c.full_name
        from work_item w, app.reassign_candidates(w.id) c
        where w.id = ${id} and w.project_id = ${projectId}
      `.execute(trx);
      if (rows.length === 0) continue;
      reassignable += 1;
      for (const r of rows) members.set(r.member_id, { name: r.full_name, items: (members.get(r.member_id)?.items ?? 0) + 1 });
    }
    return { reassignable, members: [...members].map(([memberId, m]) => ({ memberId, ...m })) };
  });
}

const reassignOutcomes = ["reassigned", "not_found", "item_closed", "project_closed", "forbidden", "not_offered"] as const;

/** Why each refusal of app.reassign_step left the item as it was: a closed item says so, every other refusal is "not offered to you". */
const reassignSkip: Record<Exclude<(typeof reassignOutcomes)[number], "reassigned">, SnagBulkSkipReason> = {
  not_found: "not_found",
  item_closed: "item_closed",
  project_closed: "item_closed",
  forbidden: "not_offered",
  not_offered: "not_offered",
};

/** Reassign: each chosen item the viewer's Participant holds goes to `toMemberId`, if the item's Step Pool holds them. */
export async function bulkReassign(db: Db, memberId: string, projectId: string, request: SnagBulkReassignRequest, now: Date): Promise<SnagBulkResult> {
  const result: SnagBulkResult = { done: [], skipped: [] };
  for (const id of [...new Set(request.ids)]) {
    const item = await visibleItem(db, memberId, projectId, id);
    if (!item) {
      result.skipped.push(skip(id, null, "not_found"));
      continue;
    }
    const outcome = await withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ outcome: string }>`select app.reassign_step(${id}::uuid, ${request.toMemberId}::uuid, ${now}) as outcome`.execute(trx);
      return checkedOutcome(rows[0]!.outcome, reassignOutcomes);
    });
    if (outcome === "reassigned") result.done.push(id);
    else result.skipped.push(skip(id, item, reassignSkip[outcome]));
  }
  return result;
}
