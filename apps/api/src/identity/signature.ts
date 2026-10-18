import { randomUUID } from "node:crypto";
import { withMember, type Db } from "@rabaed/db";
import { imageFileExtension, SIGNATURE_MAX_BYTES, type ImageFileType, type MySignature, type SaveSignatureRequest, type SignatureMethod } from "@rabaed/domain";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { isImageOf, storeImage } from "./stored-image.ts";

// A Member's Signature (RP-85, ADR 0023; data-model.md §1 member_signature). The image
// is stored by the api under the Member's own key, then app.set_member_signature records
// it as in force from now, ending the one before. Only the Member reads it (RLS); the
// Documental Record job reads anyone's as the owner.

export { isImageOf } from "./stored-image.ts";

/** Whether `bytes` are an image of `contentType`, no larger than a Signature may be. */
export function isSignatureImage(bytes: Uint8Array, contentType: ImageFileType): boolean {
  return isImageOf(bytes, contentType, SIGNATURE_MAX_BYTES);
}

export type SaveSignatureResult = { ok: true; id: string } | { ok: false; reason: "invalid_signature_image" | "not_found" };

/** Saves the Member's new Signature: stores the image, then makes it the one in force. */
export async function saveSignature(db: Db, files: FileStore, memberId: string, request: SaveSignatureRequest, now: Date): Promise<SaveSignatureResult> {
  const bytes = Buffer.from(request.data, "base64");
  if (!isSignatureImage(bytes, request.contentType)) return { ok: false, reason: "invalid_signature_image" };
  const key = `members/${memberId}/signatures/${randomUUID()}.${imageFileExtension(request.contentType)}`;
  const id = await storeImage(
    files,
    { key, bytes, contentType: request.contentType },
    (image) =>
      withMember(db, memberId, (trx) =>
        sql<{ id: string | null }>`
          select app.set_member_signature(${image.key}, ${image.sha256}, ${image.size}, ${image.mime}, ${request.method}, ${now}) as id
        `
          .execute(trx)
          .then((r) => r.rows[0]!.id),
      ),
    (saved) => saved !== null,
  );
  return id ? { ok: true, id } : { ok: false, reason: "not_found" };
}

/** The Member's own Signature in force, with a short-lived link to its image; null without one. */
export async function mySignature(db: Db, files: FileStore, memberId: string, now: Date): Promise<MySignature> {
  const row = await withMember(db, memberId, (trx) =>
    sql<{ id: string; method: SignatureMethod; active_from: Date; storage_key: string; mime: ImageFileType }>`
      select s.id, s.method, s.active_from, f.storage_key, f.mime
      from member_signature s join stored_file f on f.id = s.file_id
      where s.id = app.active_signature_id(app.current_member_id())
    `
      .execute(trx)
      .then((r) => r.rows[0]),
  );
  if (!row) return { signature: null };
  return {
    signature: {
      id: row.id,
      method: row.method,
      activeFrom: row.active_from.toISOString(),
      image: await files.signDownload(row.storage_key, { fileName: `signature.${imageFileExtension(row.mime)}`, contentType: row.mime }, now),
    },
  };
}
