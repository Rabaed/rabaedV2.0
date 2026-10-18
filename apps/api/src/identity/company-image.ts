import { createHash, randomUUID } from "node:crypto";
import { withMember, type Db } from "@rabaed/db";
import { COMPANY_IMAGE_MAX_BYTES, type CompanyImage, type CompanyImageKind, type MyCompany, type SaveCompanyImageRequest } from "@rabaed/domain";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { isImageOf } from "./signature.ts";

// A Company's logo and Stamp (RP-617, ADR 0023; data-model.md §1 company). The image is stored by
// the api under the Company's own key, then app.set_company_image points the Company at it, for
// its Authorized Person only. Every Member of the Company reads them (RLS); the Documental
// Record job reads every acting Company's as the owner.

export type SaveCompanyImageResult = { ok: true } | { ok: false; reason: "invalid_company_image" | "forbidden" | "not_found" };

/** Saves the Company's new logo or Stamp: stores the image, then makes it the one in force. */
export async function saveCompanyImage(
  db: Db,
  files: FileStore,
  memberId: string,
  companyId: string,
  kind: CompanyImageKind,
  request: SaveCompanyImageRequest,
  now: Date,
): Promise<SaveCompanyImageResult> {
  // Whose Company it is is checked first, so another Company's Member learns nothing, not
  // even whether the image would have been accepted.
  const own = await withMember(db, memberId, (trx) =>
    sql<{ manages: boolean }>`
      select c.authorized_person_id = app.current_member_id() as manages from company c
      where c.id = ${companyId}::uuid and c.id = app.current_company_id()
    `
      .execute(trx)
      .then((r) => r.rows[0]),
  );
  if (!own) return { ok: false, reason: "not_found" };
  if (!own.manages) return { ok: false, reason: "forbidden" };
  const bytes = Buffer.from(request.data, "base64");
  if (!isImageOf(bytes, request.contentType, COMPANY_IMAGE_MAX_BYTES)) return { ok: false, reason: "invalid_company_image" };
  const key = `companies/${companyId}/${kind}/${randomUUID()}.${request.contentType === "image/png" ? "png" : "jpg"}`;
  await files.put(key, bytes, request.contentType);
  try {
    const outcome = await withMember(db, memberId, (trx) =>
      sql<{ outcome: string }>`
        select app.set_company_image(
          ${companyId}::uuid, ${kind}, ${key}, ${createHash("sha256").update(bytes).digest()}, ${bytes.byteLength},
          ${request.contentType}, ${now}) as outcome
      `
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
    if (outcome !== "set") {
      await files.remove(key);
      return { ok: false, reason: outcome === "forbidden" ? "forbidden" : "not_found" };
    }
    return { ok: true };
  } catch (error) {
    // Nothing points at the stored image: remove it.
    await files.remove(key).catch(() => undefined);
    throw error;
  }
}

/** The signed-in Member's own Company profile: its logo and Stamp in force, with short-lived links; null if signed out. */
export async function myCompany(db: Db, files: FileStore, memberId: string, now: Date): Promise<MyCompany | null> {
  const row = await withMember(db, memberId, (trx) =>
    sql<{
      id: string;
      legal_name: MyCompany["company"]["legalName"];
      cr_number: string;
      vat_number: string;
      manages: boolean;
      logo_id: string | null;
      logo_key: string | null;
      logo_mime: string | null;
      logo_at: Date | null;
      stamp_id: string | null;
      stamp_key: string | null;
      stamp_mime: string | null;
      stamp_at: Date | null;
    }>`
      select c.id, c.legal_name, c.cr_number, c.vat_number, c.authorized_person_id = app.current_member_id() as manages,
        l.id as logo_id, l.storage_key as logo_key, l.mime as logo_mime, l.created_at as logo_at,
        s.id as stamp_id, s.storage_key as stamp_key, s.mime as stamp_mime, s.created_at as stamp_at
      from company c
      left join stored_file l on l.id = c.logo_file_id
      left join stored_file s on s.id = c.stamp_file_id
      where c.id = app.current_company_id()
    `
      .execute(trx)
      .then((r) => r.rows[0]),
  );
  if (!row) return null;
  const image = async (kind: CompanyImageKind, id: string | null, key: string | null, mime: string | null, at: Date | null): Promise<CompanyImage | null> =>
    id && key && mime && at
      ? {
          id,
          uploadedAt: at.toISOString(),
          image: await files.signDownload(key, { fileName: `${kind}.${mime === "image/png" ? "png" : "jpg"}`, contentType: mime }, now),
        }
      : null;
  return {
    company: { id: row.id, legalName: row.legal_name, crNumber: row.cr_number, vatNumber: row.vat_number },
    canManage: row.manages,
    logo: await image("logo", row.logo_id, row.logo_key, row.logo_mime, row.logo_at),
    stamp: await image("stamp", row.stamp_id, row.stamp_key, row.stamp_mime, row.stamp_at),
  };
}
