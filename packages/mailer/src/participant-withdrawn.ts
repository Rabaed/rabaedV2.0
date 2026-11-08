import type { ParticipantWithdrawnEmail } from "@rabaed/domain";
import type { MailMessage } from "./mailer.ts";

/**
 * A Participant withdrawn email as the mailer sends it (RP-952): in the Member's language, linking to
 * their Company's Projects on the customer web (`webUrl`), since they no longer see the Project.
 */
export function participantWithdrawnMessage(
  { to, language, projectName, hostCompanyName }: ParticipantWithdrawnEmail,
  webUrl: string,
): MailMessage<"participant-withdrawn"> {
  const link = new URL(`/${language}/participants`, webUrl).href;
  return { to, template: "participant-withdrawn", locale: language, values: { projectName, hostCompanyName, link } };
}
