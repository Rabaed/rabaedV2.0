import type { BilingualText, Locale, ParticipantWithdrawnEmail } from "@rabaed/domain";
import { sql } from "kysely";
import type { OutboxHandler } from "./outbox.ts";

// The worker's side of a Participant's withdrawal email (RP-952, ADR 0028; migration
// 20271215000000_withdraw_participant.sql). app.withdraw_participant queues one row per Member it
// tells: its Company's Authorized Person and each of its Project Members, never another Company's.

/** Sends one withdrawal email. Throws when it could not, so the outbox retries. */
export type SendParticipantWithdrawnEmail = (email: ParticipantWithdrawnEmail) => Promise<void>;

/**
 * The outbox handler of kind `participant_withdrawn`: emails the Member that their Company was
 * withdrawn from the Project, naming the Project and its Host Company, never who withdrew it.
 * Nothing when the Member is no longer active.
 */
export function participantWithdrawnHandler(send: SendParticipantWithdrawnEmail): OutboxHandler {
  return async (trx, row) => {
    const { participantId, memberId } = row.payload;
    if (typeof participantId !== "string" || typeof memberId !== "string") {
      throw new Error("participant_withdrawn row without participantId and memberId");
    }
    const { rows } = await sql<{ to_address: string; language: Locale; project_name: BilingualText; host_company_name: BilingualText }>`
      select * from app.participant_withdrawn_email(${participantId}::uuid, ${memberId}::uuid)
    `.execute(trx);
    const email = rows[0];
    if (!email) return;
    await send({ to: email.to_address, language: email.language, projectName: email.project_name, hostCompanyName: email.host_company_name });
  };
}
