/** The pages drawn in the sign-in design's frame (RP-1057): sign-in, and asking for and using a reset link (RP-1058). */
const ownFrame = new Set(["/sign-in", "/forgot-password", "/reset-password"]);

/**
 * Signed-out pages that draw their own full-page frame, so the layout leaves out its header
 * and narrow column (RP-1057). `pathname` is without the locale, as next-intl's `usePathname` gives it.
 */
export function hasOwnFrame(pathname: string): boolean {
  return ownFrame.has(pathname.replace(/\/$/, ""));
}
