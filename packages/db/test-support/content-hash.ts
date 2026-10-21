import { createHash } from "node:crypto";

/**
 * A JSON value as Postgres prints a jsonb: an object's keys shortest first, then
 * by their bytes, with ", " and ": " between. For tests that work a hash out from
 * its inputs rather than by calling the database function under test.
 */
export function jsonbText(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${jsonbText((value as Record<string, unknown>)[k])}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

/** The SHA-256 of a file's bytes as hex, the form a Transition's content hash names (a UTF-8 string is hashed as its bytes). */
export function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The SHA-256 of a file's bytes as `bytea`, the form `document.file_sha256` and `confirm_document_upload` take. */
export function sha256Bytea(body: string | Buffer): Buffer {
  return createHash("sha256").update(body).digest();
}

/**
 * A Document as a Transition's content hash names it (workflow-engine.md §7): these
 * columns, and `file_sha256` (hex, null before the upload is confirmed), the fingerprint
 * of its bytes (RP-618, as built). Keep the list in step with the `jsonb_build_object`
 * of `app.work_item_content_sha256` (`pnpm db:fn work_item_content_sha256`).
 */
export type HashedDocument = {
  id: string;
  field_key: string | null;
  item_key: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  file_sha256: string | null;
};

/**
 * The columns of `document` a Transition's content hash names, as a select list for the
 * migrator: rows that read as a `HashedDocument`. The one list to change with the SQL.
 */
export const HASHED_DOCUMENT_COLUMNS =
  "id, field_key, item_key, file_name, content_type, size_bytes::int as size_bytes, storage_key, encode(file_sha256, 'hex') as file_sha256";

/**
 * The content hash a Transition's event should carry (RP-436, workflow-engine.md
 * §7): SHA-256, hex, of the item's Subject, answers, outcome and Documents (by id)
 * as the Transition leaves it, worked out from the spec, not by the database. An item a
 * Transition took a reply Screen's checklist from (RP-86) adds `checklists`: each one's
 * field key and answers, by field key.
 */
export function expectedContentSha256(content: {
  title: string;
  data: object;
  outcome: string | null;
  documents: HashedDocument[];
  checklists?: { field_key: string; answers: object }[];
}): string {
  const documents = [...content.documents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const { checklists, ...rest } = content;
  const taken = checklists && checklists.length > 0 ? { checklists: [...checklists].sort((a, b) => (a.field_key < b.field_key ? -1 : 1)) } : {};
  return createHash("sha256").update(jsonbText({ ...rest, documents, ...taken }), "utf8").digest("hex");
}
