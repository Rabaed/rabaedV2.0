import type { RecordFace } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.ts";

// The record's printed face (RP-157; migration 20270828000000_documental_record_verification.sql;
// workflow-engine.md §7): what the public verification page shows, as the worker took it from the
// Record Data it printed. Written by the record job and by a Re-produce that passes, as the app role
// with no Member set; read only by the verification functions.

/** Saves the face of the record of a 'documental_record' or 'documental_record_reproduce' outbox row; false when it names none. */
export async function saveDocumentalRecordFace(trx: Transaction<Database>, outboxId: string, face: RecordFace): Promise<boolean> {
  const { rows } = await sql<{ saved: boolean }>`
    select app.save_documental_record_face(${outboxId}::uuid, ${JSON.stringify(face)}::jsonb) as saved
  `.execute(trx);
  return rows[0]?.saved ?? false;
}
