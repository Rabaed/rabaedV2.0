import { z } from "zod";
import { bilingualText } from "./company.ts";

// Documents: the files of a Work Item's Attachments System Field (RP-269). The
// browser uploads and downloads them with short-lived signed URLs the api
// creates; the api is the only signer.

/**
 * The file types a Document may have unless the environment configures others
 * (DOCUMENT_CONTENT_TYPES): PDFs, images, Office files, drawings, plain text and zip.
 */
export const defaultDocumentContentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/vnd.dwg",
  "image/vnd.dxf",
  "text/plain",
  "text/csv",
  "application/zip",
] as const;

/** The largest Document unless the environment configures another size (DOCUMENT_MAX_MB). */
export const defaultDocumentMaxBytes = 50 * 1024 * 1024;

/** A media type, lower case, without parameters: `application/pdf`. */
export const contentType = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/);

// Browsers know no type for some files Documents may be: named from the extension.
const typesByExtension: Record<string, string> = { dwg: "image/vnd.dwg", dxf: "image/vnd.dxf", heic: "image/heic", csv: "text/csv" };

/** The content type to declare for a file the browser picked: its own, else by its extension. */
export function contentTypeOfFile(file: { name: string; type: string }): string {
  return file.type || typesByExtension[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
}

/** Step 1 of an upload: the file the browser is about to upload. */
export const startDocumentUploadRequest = z.object({
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentType,
  /** The Form's `attachments` field the file is for (RP-281); none for the Attachments System Field. */
  fieldKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64)
    .optional(),
});
export type StartDocumentUploadRequest = z.infer<typeof startDocumentUploadRequest>;

/** A short-lived signed URL. */
export const signedUrl = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export type SignedUrl = z.infer<typeof signedUrl>;

/** Step 2: PUT the file's bytes to `url` with exactly these headers, before `expiresAt`; then confirm. */
export const startedDocumentUpload = z.object({
  id: z.uuid(),
  upload: signedUrl.extend({ method: z.literal("PUT"), headers: z.record(z.string(), z.string()) }),
});
export type StartedDocumentUpload = z.infer<typeof startedDocumentUpload>;

/** One Document of a Work Item, for someone who can see the item. */
export const documentSummary = z.object({
  id: z.uuid(),
  fileName: z.string(),
  sizeBytes: z.number().int().positive(),
  contentType: z.string(),
  uploadedAt: z.iso.datetime(),
  /** The uploader's Company; a person's name only within the viewer's own Company (visibility.md V14). */
  uploadedBy: z.object({ companyName: bilingualText, memberName: bilingualText.nullable() }),
  /** Frozen once the item was first sent or submitted: it never changes again. */
  frozen: z.boolean(),
  /** The Form's `attachments` field it belongs to; null for the Attachments System Field. */
  fieldKey: z.string().nullable(),
});
export type DocumentSummary = z.infer<typeof documentSummary>;

export const documentList = z.object({
  documents: z.array(documentSummary),
  /** The viewer may upload and remove Documents now (the raiser's Company, in Draft, with Attach). */
  canChange: z.boolean(),
  /** The limits an upload must keep to. */
  limits: z.object({ maxBytes: z.number().int().positive(), contentTypes: z.array(z.string()) }),
});
export type DocumentList = z.infer<typeof documentList>;
