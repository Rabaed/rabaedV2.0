import { createHash } from "node:crypto";
import { withMember, type Database, type Db } from "@rabaed/db";
import type { BilingualText, BulkOffer, BulkStop, BulkStopReason, BulkTransitionRequest, PackageItem } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { takeTransitionIn, type TakeTransitionResult } from "./work-items.ts";

// Bulk Transitions (spec RP-616 stories 39–45; RP-646): one Transition on several
// items at once, all or nothing, in one transaction. Each item is taken through the
// single Transition's path (takeTransitionIn, app.take_transition), so each gets its
// own events, Issued Code and notifications, exactly as if taken alone. Not tied to
// Packages: the Package page offers it (packages.ts), the List may later.
//
// Each item is signed exactly as in a single Transition, so a bulk action never
// bypasses a signature (spec story 44, as settled 2026-10-19). There is no signing
// check of its own: since ADR 0017 every Transition is confirmed and signed, and
// nothing in a Workflow marks one as signing (`workflow_step.is_signing` is read by
// nothing, always false, and RP-85 drops it). Each item's own `app.take_transition`
// checks the Member's Signature, so a Member without one is refused all or nothing.

type Trx = Transaction<Database>;

/** An item as the bulk check reads it: whether it waits on the Member, and the Action Form of the Transition they'd take on it. */
type Candidate = { id: string; document_number: string | null; title: string; need: string | null; form: string | null };

/** Which Action Form Transition `tr` shows: its pinned Screen Version, or its inline Action Form (none too). */
const formToken = sql<string>`coalesce('screen:' || tr.screen_version_id::text, 'form:' || md5(coalesce(tr.action_form::text, 'none')))`;

/**
 * Items `ids` the acting Member sees, in the order given, each with whether it waits
 * on them (app.need_my_action) and, when they may take `transition` on it now (as
 * the item's own page offers it, app.work_item_actions), its Action Form (formToken).
 */
async function candidates(trx: Trx, ids: string[], transition: string): Promise<Candidate[]> {
  const { rows } = await sql<Candidate>`
    select w.id, w.document_number, w.title, app.need_my_action(w.id) as need,
      (select ${formToken}
        from app.work_item_actions(w.id) a (action, transition_key, label, transition_kind)
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
        where a.action = 'transition' and a.transition_key = ${transition}
        limit 1) as form
    from unnest(${ids}::uuid[]) with ordinality as u (id, n)
    join work_item w on w.id = u.id
    order by u.n
  `.execute(trx);
  return rows;
}

/**
 * What the acting Member may take in bulk on each of items `ids` they see (the
 * Package page's selection, RP-646): on an item waiting on them, each Transition its
 * own page offers them, with its Action Form; none on any other. By item id.
 */
export async function bulkOffers(trx: Trx, ids: string[]): Promise<Map<string, BulkOffer[]>> {
  const offers = new Map<string, BulkOffer[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return offers;
  const { rows } = await sql<{ id: string; key: string; label: BilingualText; form: string }>`
    select w.id, a.transition_key as key, a.label, ${formToken} as form
    from unnest(${ids}::uuid[]) with ordinality as u (id, n)
    join work_item w on w.id = u.id
    cross join lateral app.work_item_actions(w.id) with ordinality a (action, transition_key, label, transition_kind, m)
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
    where a.action = 'transition' and app.need_my_action(w.id) = 'waiting'
    order by u.n, a.m
  `.execute(trx);
  for (const r of rows) offers.get(r.id)?.push({ key: r.key, label: r.label, form: r.form });
  return offers;
}

/** The first item that can't take the Transition with the others, and why; null when none. */
function firstStop(items: Candidate[]): { item: Candidate; reason: BulkStopReason } | null {
  const form = items[0]?.form ?? null;
  for (const item of items) {
    if (item.need !== "waiting") return { item, reason: "not_waiting" };
    if (item.form === null) return { item, reason: "transition_not_offered" };
    if (item.form !== form) return { item, reason: "different_action_form" };
  }
  return null;
}

export type BulkTransitionResult =
  | { ok: true; taken: PackageItem[] }
  | { ok: false; reason: "bulk_refused"; stoppedBy: BulkStop }
  | { ok: false; reason: "not_found" | "not_confirmed" | "idempotency_key_reused" };

/** Undoes a bulk Transition's transaction, answering `result`. */
class Rollback extends Error {
  constructor(readonly result: BulkTransitionResult) {
    super("Bulk Transition rolled back");
  }
}

/** Each item's own key for its Transition, from the request's: the same request again gives the same keys. */
function itemKey(key: string, workItemId: string): string {
  const h = createHash("sha256").update(`bulk_transition/${key}/${workItemId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const asItem = (c: Candidate): PackageItem => ({ id: c.id, documentNumber: c.document_number, title: c.title });

/** Why an item's own Transition refused it, as a bulk stop. */
function stopFrom(item: Candidate, taken: Exclude<TakeTransitionResult, { ok: true }>): BulkStop {
  const passed: BulkStopReason[] = ["form_incomplete", "invalid_action_form", "validation_failed", "assignee_not_offered"];
  const reason = (passed as string[]).includes(taken.reason) ? (taken.reason as BulkStopReason) : "refused";
  return {
    ...asItem(item),
    reason,
    ...("errors" in taken && reason !== "refused" ? { errors: taken.errors } : {}),
    ...("message" in taken ? { message: taken.message } : {}),
  };
}

/**
 * The acting Member takes Transition `input.transition` on every item of
 * `input.workItemIds`, with the same answers, Internal Note and "Assign to" pick.
 * Accepted only when every item is one they see (else the plain 404), waits on them,
 * and offers them that Transition with the same Action Form (Screen Version); then
 * each is taken through the single Transition's path, in one transaction. All or
 * nothing: the first item that stops it is named with why, and nothing is taken.
 */
export async function takeBulkTransition(db: Db, memberId: string, input: Required<BulkTransitionRequest>, now: Date): Promise<BulkTransitionResult> {
  const ids = [...new Set(input.workItemIds)];
  try {
    return await withMember(db, memberId, async (trx): Promise<BulkTransitionResult> => {
      // The request's key first: the same request again waits for this one to commit, then replays.
      await sql`select pg_advisory_xact_lock(hashtextextended(${memberId}::uuid::text || '/bulk/' || ${input.idempotencyKey}::uuid::text, 0))`.execute(trx);
      const items = await candidates(trx, ids, input.transition);
      // One the Member doesn't see is the plain 404, whichever it is.
      if (items.length !== ids.length) return { ok: false, reason: "not_found" };
      if (!input.confirmed) return { ok: false, reason: "not_confirmed" };
      // Applied before: every item's key is used, and each take below replays. Some only: the key was used for other items.
      const keys = ids.map((id) => itemKey(input.idempotencyKey, id));
      const { rows } = await sql<{ used: number }>`select app.command_keys_used(${keys}::uuid[]) as used`.execute(trx);
      const used = rows[0]!.used;
      if (used > 0 && used < keys.length) return { ok: false, reason: "idempotency_key_reused" };
      const stop = used === 0 ? firstStop(items) : null;
      if (stop) return { ok: false, reason: "bulk_refused", stoppedBy: { ...asItem(stop.item), reason: stop.reason } };

      for (const item of items) {
        const taken = await takeTransitionIn(
          trx,
          memberId,
          item.id,
          {
            transition: input.transition,
            answers: input.answers,
            internalNote: input.internalNote,
            assignTo: input.assignTo,
            recommendedCode: null,
            confirmed: true,
            idempotencyKey: itemKey(input.idempotencyKey, item.id),
          },
          now,
        );
        if (!taken.ok) throw new Rollback({ ok: false, reason: "bulk_refused", stoppedBy: stopFrom(item, taken) });
      }
      return { ok: true, taken: await movedItems(trx, ids) };
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}

/** Items `ids` as the acting Member reads them now, in the order given. */
async function movedItems(trx: Trx, ids: string[]): Promise<PackageItem[]> {
  const { rows } = await sql<{ id: string; document_number: string | null; title: string }>`
    select w.id, w.document_number, w.title
    from unnest(${ids}::uuid[]) with ordinality as u (id, n)
    join work_item w on w.id = u.id
    order by u.n
  `.execute(trx);
  return rows.map((r) => ({ id: r.id, documentNumber: r.document_number, title: r.title }));
}
