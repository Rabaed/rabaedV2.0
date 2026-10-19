import { createHash, randomUUID } from "node:crypto";
import { CompiledQuery } from "kysely";
import type { Db } from "../src/client.ts";

/** Runs one parameterised SQL statement as the migrator (the owner). */
export type RunAsOwner = (text: string, values: unknown[]) => Promise<unknown>;

/** `db`'s statements as a RunAsOwner; `db` connects as the migrator. */
export const runAsOwner =
  (db: Db): RunAsOwner =>
  (text, values) =>
    db.executeQuery(CompiledQuery.raw(text, values));

/**
 * Gives `memberId` an active Signature (RP-85: no Signature, no Transition), as the
 * owner: a `stored_file` row and a `member_signature` row in force from now. No image
 * is stored; nothing a test reads opens it. Returns `memberId`, so a Member's insert can
 * be wrapped: `withSignature(run, await insertMember(...))`. Ends any Signature in force.
 */
export async function withSignature(run: RunAsOwner, memberId: string): Promise<string> {
  const id = randomUUID();
  await withoutSignature(run, memberId);
  await run(
    `with file as (
       insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id)
       values ($2, $3, 68, 'image/png', $1::uuid) returning id
     )
     insert into member_signature (member_id, file_id, method, active_from)
     select $1::uuid, file.id, 'drawn', now() from file`,
    [memberId, `members/${memberId}/signatures/${id}.png`, createHash("sha256").update(id).digest()],
  );
  return memberId;
}

/** Ends `memberId`'s Signature in force, as the owner: they have none until they add one. */
export async function withoutSignature(run: RunAsOwner, memberId: string): Promise<void> {
  await run("update member_signature set active_to = now() where member_id = $1::uuid and active_to is null", [memberId]);
}
