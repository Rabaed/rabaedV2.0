import { createHash } from "node:crypto";
import { withMember, type Database, type Db } from "@rabaed/db";
import type { PackageItem, TakeTransitionRequest } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { withFileCopies, type CopyFiles } from "../documents/copy-files.ts";
import type { FileStore } from "../documents/file-store.ts";
import { takeTransitionIn, type TakeTransitionResult } from "./work-items.ts";

// Several Transitions in one transaction, all or nothing (Submit Package, RP-638; a bulk
// Transition, RP-646): each item taken through the single Transition's path (takeTransitionIn,
// app.take_transition), so each gets its own events, Issued Code and notifications exactly as
// if taken alone, with a key of its own made from the request's.
//
// The lock order (data-model.md "Lock order"): a single Transition locks its item, then its
// Package (the status trigger). A command here locks all its items first, in order of id
// (app.lock_work_items), before anything locks a Package, so the two never wait on each other
// the other way round.

type Trx = Transaction<Database>;

/** Undoes an all-or-nothing command's transaction, answering `result`. */
export class Rollback<R> extends Error {
  constructor(readonly result: R) {
    super("Rolled back");
  }
}

/**
 * `run` in the acting Member's transaction; a Rollback thrown in it undoes the transaction and
 * answers its result. `copy` copies files (a code's Snags' photos, RP-577) that are deleted again
 * when it doesn't commit (withFileCopies).
 */
export async function allOrNothing<R>(db: Db, files: FileStore, memberId: string, run: (trx: Trx, copy: CopyFiles) => Promise<R>): Promise<R> {
  try {
    return await withFileCopies(files, (copy) => withMember(db, memberId, (trx) => run(trx, copy)));
  } catch (e) {
    if (e instanceof Rollback) return e.result as R;
    throw e;
  }
}

/** Each item's own key for its Transition in command `command`, from the request's: the same request again gives the same keys. */
export function itemKey(command: string, key: string, workItemId: string): string {
  const h = createHash("sha256").update(`${command}/${key}/${workItemId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Locks items `ids` the acting Member sees, in order of id, until the transaction ends: before any Package. */
export async function lockWorkItems(trx: Trx, ids: string[]): Promise<void> {
  if (ids.length > 0) await sql`select app.lock_work_items(${ids}::uuid[])`.execute(trx);
}

/** A Transition to take on one item: its own key is made from the request's. */
export type ItemTransition = { workItemId: string; input: Omit<Required<TakeTransitionRequest>, "idempotencyKey" | "confirmed"> };
export type ItemRefusal = { workItemId: string; refused: Exclude<TakeTransitionResult, { ok: true }> };

/**
 * Takes each of `takes` in turn, confirmed (the command's pop-up confirmed them all, ADR 0017),
 * each under its own key from command `command`'s `key`. Stops at the first refusal when `stop`
 * says so, else goes on through all; answers the refusals. The caller locks the items first
 * (lockWorkItems) and throws a Rollback when any is refused.
 */
export async function takeEach(
  trx: Trx,
  memberId: string,
  takes: ItemTransition[],
  { command, key, now, stopAtFirst, copy }: { command: string; key: string; now: Date; stopAtFirst: boolean; copy: CopyFiles },
): Promise<ItemRefusal[]> {
  const refusals: ItemRefusal[] = [];
  for (const { workItemId, input } of takes) {
    const taken = await takeTransitionIn(trx, copy, memberId, workItemId, { ...input, confirmed: true, idempotencyKey: itemKey(command, key, workItemId) }, now);
    if (taken.ok) continue;
    refusals.push({ workItemId, refused: taken });
    if (stopAtFirst) break;
  }
  return refusals;
}

/** Items `ids` as the acting Member reads them now, in the order given. */
export async function itemsById(trx: Trx, ids: string[]): Promise<PackageItem[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql<{ id: string; document_number: string | null; title: string }>`
    select w.id, w.document_number, w.title
    from unnest(${ids}::uuid[]) with ordinality as u (id, n)
    join work_item w on w.id = u.id
    order by u.n
  `.execute(trx);
  return rows.map((r) => ({ id: r.id, documentNumber: r.document_number, title: r.title }));
}
