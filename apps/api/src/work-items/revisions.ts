import { withMember, type Db } from "@rabaed/db";
import { createReplacementRefusals, createRevisionRefusals, discardRevisionRefusals, type BilingualText, type RevisionChain } from "@rabaed/domain";
import { sql } from "kysely";
import { withFileCopies } from "../documents/copy-files.ts";
import type { FileStore } from "../documents/file-store.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Revisions (workflow-engine.md §5.4; RP-316). The database decides who may
// create or discard one, and when (app.create_revision, app.discard_revision);
// a refusal names nothing about the chain, so nobody outside the raiser learns
// whether a Draft Revision is open. A new Revision's Documents are new rows,
// whose files are copied here, in the same transaction: if a copy or the
// transaction fails, the files already copied are deleted (withFileCopies) and
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
  return withFileCopies(files, (copy) => withMember(db, memberId, async (trx): Promise<CreateRevisionResult> => {
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
      await copy(copies);
      // Its Checklist Template pick came over with its answers (app.fill_revision): its copy now too, the
      // Version the revised item holds (RP-651). A Revision held by someone else gets it on their first save.
      const { rows: synced } = await sql<{ outcome: string }>`
        select app.sync_work_item_checklists(${id}::uuid, ${now}) as outcome
      `.execute(trx);
      checkedOutcome(synced[0]!.outcome, ["synced", "not_editable"]);
    }
    return { ok: true, id };
  }));
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
  return withFileCopies(files, (copy) => withMember(db, memberId, async (trx): Promise<CreateReplacementResult> => {
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
      await copy(copies);
    }
    return { ok: true, id };
  }));
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
 * the Member can't see the item. Each with its Stage as its own page shows the
 * Member (app.step_as_seen, as the item's read does; RP-1188): never its Step.
 */
export function getRevisionChain(db: Db, memberId: string, workItemId: string): Promise<RevisionChain | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{
      work_item_id: string;
      document_number: string | null;
      revision_no: number;
      stage_key: string;
      stage_name: BilingualText;
      stage_category: RevisionChain["revisions"][number]["stage"]["category"];
    }>`
      select c.work_item_id, c.document_number, c.revision_no,
        st.key as stage_key, st.name as stage_name, st.category as stage_category
      from app.revision_chain(${workItemId}::uuid) c
      join work_item w on w.id = c.work_item_id
      cross join lateral app.step_as_seen(w.id) seen
      join work_item_type t on t.id = w.work_item_type_id
      join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
      order by c.revision_no
    `.execute(trx);
    // The item itself is always in its own chain, so nothing back means it is hidden.
    if (rows.length === 0) return null;
    return {
      revisions: rows.map((r) => ({
        id: r.work_item_id,
        documentNumber: r.document_number,
        revisionNo: r.revision_no,
        stage: { key: r.stage_key, name: r.stage_name, category: r.stage_category },
      })),
    };
  });
}
