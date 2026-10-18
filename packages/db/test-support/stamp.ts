import { createHash, randomUUID } from "node:crypto";
import type { RunAsOwner } from "./signature.ts";

/**
 * Gives `companyId` a new Stamp (RP-617: no Stamp, no Transition), as the owner: a
 * `stored_file` row that `company.stamp_file_id` points at. No image is stored; nothing a
 * test reads opens it. Returns `companyId`.
 */
export async function withStamp(run: RunAsOwner, companyId: string): Promise<string> {
  const id = randomUUID();
  await run(
    `with file as (
       insert into stored_file (storage_key, sha256, size, mime)
       values ($2, $3, 68, 'image/png') returning id
     )
     update company set stamp_file_id = file.id from file where company.id = $1::uuid`,
    [companyId, `companies/${companyId}/stamp/${id}.png`, createHash("sha256").update(id).digest()],
  );
  return companyId;
}

/** Takes `companyId`'s Stamp away, as the owner: none of its Members can act until one is added. */
export async function withoutStamp(run: RunAsOwner, companyId: string): Promise<void> {
  await run("update company set stamp_file_id = null where id = $1::uuid", [companyId]);
}
