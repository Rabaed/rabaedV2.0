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

/** A Document as a Transition's content hash names it (workflow-engine.md §7). */
export type HashedDocument = {
  id: string;
  field_key: string | null;
  item_key: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
};

/**
 * The content hash a Transition's event should carry (RP-436, workflow-engine.md
 * §7): SHA-256, hex, of the item's Subject, answers, outcome and Documents (by id)
 * as the Transition leaves it, worked out from the spec, not by the database.
 */
export function expectedContentSha256(content: { title: string; data: object; outcome: string | null; documents: HashedDocument[] }): string {
  const documents = [...content.documents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256").update(jsonbText({ ...content, documents }), "utf8").digest("hex");
}
