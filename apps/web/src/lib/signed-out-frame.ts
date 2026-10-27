/**
 * Signed-out pages that draw their own full-page frame, so the layout leaves out its header
 * and narrow column (RP-1057). `pathname` is without the locale, as next-intl's `usePathname` gives it.
 */
export function hasOwnFrame(pathname: string): boolean {
  return pathname.replace(/\/$/, "") === "/sign-in";
}
