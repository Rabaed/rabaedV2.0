import { withMember, type Db } from "@rabaed/db";
import type { WatchState } from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";

// Watch (RP-354; GLOSSARY "Watch"; visibility.md the Watch row). The database
// keeps one Watch per Member and Revision chain, so watching or unwatching any
// Revision does it for the chain. A Member acts on and reads only their own
// Watch, and only of an item they see (app.watch_work_item and its siblings);
// nothing here reads anyone else's.

const refusals = ["not_found"] as const;
export type WatchResult = { ok: true } | { ok: false; reason: (typeof refusals)[number] };

/** The acting Member watches the item, and so its whole Revision chain. */
export function watchWorkItem(db: Db, memberId: string, workItemId: string): Promise<WatchResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.watch_work_item(${workItemId}::uuid) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "watching", refusals);
  });
}

/** The acting Member stops watching the item's Revision chain, whichever Revision it is. */
export function unwatchWorkItem(db: Db, memberId: string, workItemId: string): Promise<WatchResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.unwatch_work_item(${workItemId}::uuid) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "not_watching", refusals);
  });
}

/** Whether the acting Member watches the item; null when they can't see it. */
export function getWatchState(db: Db, memberId: string, workItemId: string): Promise<WatchState | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ watching: boolean | null }>`select app.watching_work_item(${workItemId}::uuid) as watching`.execute(trx);
    const watching = rows[0]!.watching;
    return watching === null ? null : { watching };
  });
}
