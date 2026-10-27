/**
 * The Authorized Person reactivates a deactivated Member of their Company
 * (visibility.md V17). One who had never accepted their first invitation is
 * emailed a new one: returns the address it went to, else null; throws when refused.
 */
export async function requestReactivation(memberId: string): Promise<{ invitationSentTo: string | null }> {
  const res = await fetch(`/api/v1/members/${encodeURIComponent(memberId)}/reactivate`, { method: "POST" });
  if (!res.ok) throw new Error(`reactivate: ${res.status}`);
  const { invitationSentTo } = (await res.json()) as { invitationSentTo?: string };
  return { invitationSentTo: invitationSentTo ?? null };
}
