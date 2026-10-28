import type { BilingualText, Locale, ParticipantInvitationEmail } from "@rabaed/domain";
import { sql } from "kysely";
import type { OutboxHandler } from "./outbox.ts";

// The worker's side of the Participant Invitation email (RP-1072; migration
// 20271024000000_participant_invitation_email.sql). app.add_participant queues the row only for a
// Company on Rabaed, so the Project Admin's answer is the same for any CR number and never waits
// for the email.

/** Sends a Participant Invitation's email. Throws when it could not, so the outbox retries. */
export type SendParticipantInvitationEmail = (email: ParticipantInvitationEmail) => Promise<void>;

/**
 * The outbox handler of kind `participant_invitation`: emails the invited Company's Authorized
 * Person what they see of the invitation before accepting. Nothing when the invitation was
 * withdrawn, answered or sent again since, or nobody active can answer it.
 */
export function participantInvitationHandler(send: SendParticipantInvitationEmail): OutboxHandler {
  return async (trx, row) => {
    const { participantId, invitedAt } = row.payload;
    if (typeof participantId !== "string" || typeof invitedAt !== "string") {
      throw new Error("participant_invitation row without participantId and invitedAt");
    }
    const { rows } = await sql<{
      to_address: string;
      language: Locale;
      project_name: BilingualText;
      host_name: BilingualText;
      role_name: BilingualText;
    }>`
      select * from app.participant_invitation_email(${participantId}::uuid, ${invitedAt}::timestamptz)
    `.execute(trx);
    const email = rows[0];
    if (!email) return;
    await send({
      to: email.to_address,
      language: email.language,
      projectName: email.project_name,
      hostCompanyName: email.host_name,
      roleName: email.role_name,
    });
  };
}
