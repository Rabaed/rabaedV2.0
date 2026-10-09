import { withMember, type Db } from "@rabaed/db";
import { createReplacementRefusals, createRevisionRefusals, discardRevisionRefusals, type RevisionChain } from "@rabaed/domain";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Revisions (workflow-engine.md §5.4; RP-316). The database decides who may
// create or discard one, and when (app.create_revision, app.discard_revision);
// a refusal names nothing about the chain, so nobody outside the raiser learns
// whether a Draft Revision is open. A new Revision's Documents are new rows,
// whose files are copied here, in the same transaction: if a copy fails,
// nothing is created.

export type CreateRevisionResult = { ok: true; id: string } | { ok: false; reason: (typeof createRevisionRefusals)[number] };

/** The acting Member creates a Revision of a closed item; the same key again answers with the same Revision. */
export function createRevision(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  idempotencyKey: string,
  now: Date,
): Promise<CreateRevisionResult> {
  return withMember(db, memberId, async (trx): Promise<CreateRevisionResult> => {
    const { rows } = await sql<{ outcome: string; work_item_id: string | null }>`
      select outcome, work_item_id from app.create_revision(${workItemId}::uuid, ${idempotencyKey}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", "applied", ...createRevisionRefusals]);
    if (outcome !== "created" && outcome !== "applied") return { ok: false, reason: outcome };
    const id = rows[0]!.work_item_id!;
    if (outcome === "created") {
      const { rows: copies } = await sql<{ storage_key: string; source_storage_key: string }>`
        select storage_key, source_storage_key from app.revision_document_copies(${id}::uuid)
      `.execute(trx);
      for (const c of copies) await files.copy(c.source_storage_key, c.storage_key);
    }
    return { ok: true, id };
  });
}

export type CreateReplacementResult = { ok: true; id: string } | { ok: false; reason: (typeof createReplacementRefusals)[number] };

/**
 * The acting Member creates a replacement of an item closed with an outcome that
 * offers one (workflow-engine.md §5.5): a new Draft, not a Revision; the same key
 * again answers with the same one. Its Documents are copied here like a Revision's.
 */
export function createReplacement(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  idempotencyKey: string,
  now: Date,
): Promise<CreateReplacementResult> {
  return withMember(db, memberId, async (trx): Promise<CreateReplacementResult> => {
    const { rows } = await sql<{ outcome: string; work_item_id: string | null }>`
      select outcome, work_item_id from app.create_replacement(${workItemId}::uuid, ${idempotencyKey}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", "applied", ...createReplacementRefusals]);
    if (outcome !== "created" && outcome !== "applied") return { ok: false, reason: outcome };
    const id = rows[0]!.work_item_id!;
    if (outcome === "created") {
      const { rows: copies } = await sql<{ storage_key: string; source_storage_key: string }>`
        select storage_key, source_storage_key from app.revision_document_copies(${id}::uuid)
      `.execute(trx);
      for (const c of copies) await files.copy(c.source_storage_key, c.storage_key);
    }
    return { ok: true, id };
  });
}

export type DiscardRevisionResult = { ok: true } | { ok: false; reason: (typeof discardRevisionRefusals)[number] };

/** The acting Member discards a Revision still in Draft: nobody sees it again, and its Rev number is free. */
export function discardRevision(db: Db, memberId: string, workItemId: string, now: Date): Promise<DiscardRevisionResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.discard_revision(${workItemId}::uuid, ${now}) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "discarded", discardRevisionRefusals);
  });
}

/**
 * The Revision drop-down (RP-318): the Revisions of the item's chain the Member
 * sees, the original first, each by V1 on its own (app.revision_chain); null when
 * the Member can't see the item.
 */
export function getRevisionChain(db: Db, memberId: string, workItemId: string): Promise<RevisionChain | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ work_item_id: string; document_number: string | null; revision_no: number }>`
      select work_item_id, document_number, revision_no from app.revision_chain(${workItemId}::uuid)
    `.execute(trx);
    // The item itself is always in its own chain, so nothing back means it is hidden.
    if (rows.length === 0) return null;
    return { revisions: rows.map((r) => ({ id: r.work_item_id, documentNumber: r.document_number, revisionNo: r.revision_no })) };
  });
}
