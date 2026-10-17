import { createHash, randomUUID } from "node:crypto";
import { withMember, type Db } from "@rabaed/db";
import { SIGNATURE_MAX_BYTES, type MySignature, type SaveSignatureRequest, type SignatureImageType, type SignatureMethod } from "@rabaed/domain";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";

// A Member's Signature (RP-85, ADR 0023; data-model.md §1 member_signature). The image
// is stored by the api under the Member's own key, then app.set_member_signature records
// it as in force from now, ending the one before. Only the Member reads it (RLS); the
// Documental Record job reads anyone's as the owner.

/** The first bytes of each image type a Signature may be. */
const magic: Record<SignatureImageType, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

/** Whether `bytes` are an image of `contentType`, no larger than a Signature may be. */
export function isSignatureImage(bytes: Uint8Array, contentType: SignatureImageType): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > SIGNATURE_MAX_BYTES) return false;
  return magic[contentType].every((b, i) => bytes[i] === b);
}

export type SaveSignatureResult = { ok: true; id: string } | { ok: false; reason: "invalid_signature_image" | "not_found" };

/** Saves the Member's new Signature: stores the image, then makes it the one in force. */
export async function saveSignature(db: Db, files: FileStore, memberId: string, request: SaveSignatureRequest, now: Date): Promise<SaveSignatureResult> {
  const bytes = Buffer.from(request.data, "base64");
  if (!isSignatureImage(bytes, request.contentType)) return { ok: false, reason: "invalid_signature_image" };
  const key = `members/${memberId}/signatures/${randomUUID()}.${request.contentType === "image/png" ? "png" : "jpg"}`;
  await files.put(key, bytes, request.contentType);
  try {
    const id = await withMember(db, memberId, (trx) =>
      sql<{ id: string | null }>`
        select app.set_member_signature(
          ${key}, ${createHash("sha256").update(bytes).digest()}, ${bytes.byteLength}, ${request.contentType},
          ${request.method}, ${now}) as id
      `
        .execute(trx)
        .then((r) => r.rows[0]!.id),
    );
    if (!id) {
      await files.remove(key);
      return { ok: false, reason: "not_found" };
    }
    return { ok: true, id };
  } catch (error) {
    // Nothing points at the stored image: remove it.
    await files.remove(key).catch(() => undefined);
    throw error;
  }
}

/** The Member's own Signature in force, with a short-lived link to its image; null without one. */
export async function mySignature(db: Db, files: FileStore, memberId: string, now: Date): Promise<MySignature> {
  const row = await withMember(db, memberId, (trx) =>
    sql<{ id: string; method: SignatureMethod; active_from: Date; storage_key: string; mime: string }>`
      select s.id, s.method, s.active_from, f.storage_key, f.mime
      from member_signature s join stored_file f on f.id = s.file_id
      where s.member_id = app.current_member_id() and s.active_to is null
    `
      .execute(trx)
      .then((r) => r.rows[0]),
  );
  if (!row) return { signature: null };
  const fileName = `signature.${row.mime === "image/png" ? "png" : "jpg"}`;
  return {
    signature: {
      id: row.id,
      method: row.method,
      activeFrom: row.active_from.toISOString(),
      image: await files.signDownload(row.storage_key, { fileName, contentType: row.mime }, now),
    },
  };
}
