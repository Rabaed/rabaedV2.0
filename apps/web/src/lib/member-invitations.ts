import type { Locale } from "@rabaed/domain";

/**
 * The link an invited Member opens to set their password, in their own
 * language. The token travels in the URL fragment, which browsers never send to a server.
 */
export function invitationLink(inviteeLocale: Locale, token: string): string {
  return `${window.location.origin}/${inviteeLocale}/accept-invitation#token=${token}`;
}

/**
 * The Authorized Person reactivates a deactivated Member of their Company
 * (visibility.md V17). Returns the new invitation link for one who had never
 * accepted their first invitation, else null; throws when refused.
 */
export async function requestReactivation(memberId: string): Promise<{ link: string | null }> {
  const res = await fetch(`/api/v1/members/${encodeURIComponent(memberId)}/reactivate`, { method: "POST" });
  if (!res.ok) throw new Error(`reactivate: ${res.status}`);
  const { member, invitation } = (await res.json()) as {
    member: { locale: Locale };
    invitation?: { token: string };
  };
  return { link: invitation ? invitationLink(member.locale, invitation.token) : null };
}
