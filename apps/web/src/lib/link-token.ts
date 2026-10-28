/**
 * The token of an emailed link (an invitation, a password reset), carried in the URL fragment
 * (#token=…), which browsers never send to a server or in a Referer header. Browser only.
 */
export function tokenFromHash(hash: string = window.location.hash): string | null {
  return new URLSearchParams(hash.slice(1)).get("token");
}
