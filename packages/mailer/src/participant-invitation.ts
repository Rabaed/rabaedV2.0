import type { ParticipantInvitationEmail } from "@rabaed/domain";
import type { MailMessage } from "./mailer.ts";

/**
 * A Participant Invitation email as the mailer sends it (RP-1072): in the Authorized Person's
 * language, linking to their Company's Projects on the customer web (`webUrl`), where they accept
 * or decline it.
 */
export function participantInvitationMessage(
  { to, language, projectName, hostCompanyName, roleName }: ParticipantInvitationEmail,
  webUrl: string,
): MailMessage<"participant-invitation"> {
  const link = new URL(`/${language}/participants`, webUrl).href;
  return { to, template: "participant-invitation", locale: language, values: { projectName, hostCompanyName, roleName, link } };
}
