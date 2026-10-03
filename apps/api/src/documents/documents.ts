import { withMember, type Db } from "@rabaed/db";
import type {
  BilingualText,
  DocumentList,
  SignedUrl,
  StartDocumentUploadRequest,
  StartedDocumentUpload,
} from "@rabaed/domain";
import { sql } from "kysely";
import type { ApiConfig } from "../config.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";
import type { FileStore } from "./file-store.ts";

// Documents: the Attachments System Field (RP-269). Rows are read through RLS,
// which answers only for items the Member can see (the documents migration);
// writes go through its app.* functions, which decide who may change them and
// when. Files go straight between the browser and the file store, through URLs
// only this api signs, and only for a Document the Member can see.

type Limits = ApiConfig["documents"];

/** A visible item's Documents, or null when the Member can't see the item. */
export function listDocuments(db: Db, memberId: string, workItemId: string, limits: Limits): Promise<DocumentList | null> {
  return withMember(db, memberId, async (trx) => {
    const visible = await trx.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst();
    if (!visible) return null;
    const { rows } = await sql<{
      id: string;
      file_name: string;
      size_bytes: string;
      content_type: string;
      confirmed_at: Date;
      company_name: BilingualText;
      member_name: BilingualText | null;
      frozen: boolean;
    }>`
      select d.id, d.file_name, d.size_bytes, d.content_type, d.confirmed_at, co.legal_name as company_name,
        m.full_name as member_name, d.frozen_at is not null as frozen
      from document d
      join app.work_item_companies(d.work_item_id) co on co.participant_id = d.uploaded_by_participant_id
      -- member's own RLS shows only the viewer's own Company's people (V14).
      left join member m on m.id = d.uploaded_by_member_id
      where d.work_item_id = ${workItemId}
      order by d.confirmed_at, d.id
    `.execute(trx);
    const { rows: can } = await sql<{ can: boolean }>`select app.can_change_documents(${workItemId}::uuid) as can`.execute(trx);
    return {
      documents: rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        sizeBytes: Number(r.size_bytes),
        contentType: r.content_type,
        uploadedAt: r.confirmed_at.toISOString(),
        uploadedBy: { companyName: r.company_name, memberName: r.member_name },
        frozen: r.frozen,
      })),
      canChange: can[0]!.can,
      limits: { maxBytes: limits.maxBytes, contentTypes: limits.contentTypes },
    };
  });
}

const changeRefusals = ["not_found", "project_closed", "forbidden", "not_editable"] as const;
export type StartUploadResult =
  | { ok: true; started: StartedDocumentUpload }
  | { ok: false; reason: (typeof changeRefusals)[number] | Refused["reason"] };

/** Thrown inside a transaction to roll it back with a refusal. */
class Refused extends Error {
  constructor(readonly reason: "file_too_large" | "content_type_not_allowed") {
    super(reason);
  }
}

/**
 * Step 1: the acting Member declares a file for a visible item, and gets a URL
 * to PUT it to. The URL is signed for exactly that size and type.
 */
export function startUpload(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  file: StartDocumentUploadRequest,
  limits: Limits,
  now: Date,
): Promise<StartUploadResult> {
  return withMember(db, memberId, async (trx): Promise<StartUploadResult> => {
    const { rows } = await sql<{ outcome: string; document_id: string | null; storage_key: string | null }>`
      select outcome, document_id, storage_key from app.start_document_upload(
        ${workItemId}::uuid, ${file.fileName}, ${file.sizeBytes}, ${file.contentType}, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["started", ...changeRefusals]);
    if (outcome !== "started") return { ok: false, reason: outcome };
    // Who may upload, and when, before what is wrong with the file. Thrown, so the row is rolled back.
    if (file.sizeBytes > limits.maxBytes) throw new Refused("file_too_large");
    if (!limits.contentTypes.includes(file.contentType)) throw new Refused("content_type_not_allowed");
    const upload = await files.signUpload(rows[0]!.storage_key!, file, now);
    return { ok: true, started: { id: rows[0]!.document_id!, upload: { ...upload, method: "PUT" } } };
  }).catch((error: unknown) => {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  });
}

const confirmRefusals = [...changeRefusals, "not_uploaded", "upload_mismatch"] as const;
export type ConfirmUploadResult = { ok: true } | { ok: false; reason: (typeof confirmRefusals)[number] };

/** Step 3: the uploader confirms; the file must be in the store, exactly as declared. */
export function confirmUpload(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  documentId: string,
  now: Date,
): Promise<ConfirmUploadResult> {
  return withMember(db, memberId, async (trx): Promise<ConfirmUploadResult> => {
    const { rows } = await sql<{ storage_key: string }>`
      select storage_key from app.pending_document_upload(${workItemId}::uuid, ${documentId}::uuid)
    `.execute(trx);
    let stored: { sizeBytes: number; contentType: string } | null = null;
    if (rows[0]) {
      stored = await files.stat(rows[0].storage_key);
      if (!stored) return { ok: false, reason: "not_uploaded" };
    }
    // No pending upload of theirs: the function answers for a confirmed one, or not_found.
    const { rows: confirmed } = await sql<{ outcome: string }>`
      select app.confirm_document_upload(${workItemId}::uuid, ${documentId}::uuid,
        ${stored?.sizeBytes ?? null}::bigint, ${stored?.contentType ?? null}, ${now}) as outcome
    `.execute(trx);
    return commandResult(confirmed[0]!.outcome, "confirmed", confirmRefusals);
  });
}

const removeRefusals = [...changeRefusals, "document_frozen"] as const;
export type RemoveDocumentResult = { ok: true } | { ok: false; reason: (typeof removeRefusals)[number] };

/** The raiser's Company removes a Document of its Draft; refused once frozen. */
export function removeDocument(db: Db, memberId: string, workItemId: string, documentId: string, now: Date): Promise<RemoveDocumentResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.remove_document(${workItemId}::uuid, ${documentId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "removed", removeRefusals);
  });
}

/** A short-lived download URL for a Document the Member can see; null otherwise. */
export function downloadDocument(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  documentId: string,
  now: Date,
): Promise<SignedUrl | null> {
  return withMember(db, memberId, async (trx) => {
    const doc = await trx
      .selectFrom("document")
      .select(["storage_key", "file_name", "content_type"])
      .where("id", "=", documentId)
      .where("work_item_id", "=", workItemId)
      .executeTakeFirst();
    if (!doc) return null;
    return files.signDownload(doc.storage_key, { fileName: doc.file_name, contentType: doc.content_type }, now);
  });
}
