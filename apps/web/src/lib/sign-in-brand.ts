/** The Project Roles the sign-in brand panel shows (owner's design, RP-1057). */
export type BrandRole = "contractor" | "consultant" | "owner";

export type BrandStep = { role: BrandRole; status: "sent" | "reviewed" | "approved"; time: string };

// An illustration, not data: the design's three moments, with its own times.
const steps: readonly BrandStep[] = [
  { role: "contractor", status: "sent", time: "07:12" },
  { role: "consultant", status: "reviewed", time: "09:40" },
  { role: "owner", status: "approved", time: "12:05" },
];

/** The panel's moment at a tick of its cycle: the Role holding the document, and the status line. */
export function brandStep(tick: number): BrandStep {
  return steps[tick % steps.length]!;
}

/**
 * Signed-out pages that draw their own full-page frame, so the layout leaves out its header
 * and narrow column. `pathname` is without the locale, as next-intl's `usePathname` gives it.
 */
export function hasOwnFrame(pathname: string): boolean {
  return pathname.replace(/\/$/, "") === "/sign-in";
}
