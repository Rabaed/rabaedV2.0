import { cn } from "../../lib/cn.ts";
import { Avatar, CompanyChip } from "../data/avatar.tsx";

export type WithChipProps = {
  /** Who holds the current Step: a `person`, or a `company` as a whole (nobody has claimed it yet). */
  kind: "person" | "company";
  /** The person's display name. Shown only when they are in the viewer's Company. */
  name?: string;
  /** The person's photo, from our own origin. Shown only when they are in the viewer's Company. */
  photoSrc?: string;
  /** The holder's Company name. */
  companyName: string;
  /** The Company's logo, from our own origin. */
  logoSrc?: string;
  /** Whether the holder is in the viewer's own Company. */
  inViewerCompany: boolean;
  className?: string;
};

/**
 * Who a Work Item is with: the "With" cell of a list, a Kanban card, a stepper.
 * A person in the viewer's own Company is shown by name. Anyone in another
 * Company is shown as that Company's name only, whatever else is passed
 * (visibility V14): their name and photo never reach the page.
 */
export function WithChip({ kind, name, photoSrc, companyName, logoSrc, inViewerCompany, className }: WithChipProps) {
  if (!inViewerCompany || kind === "company" || !name) {
    return <CompanyChip name={companyName} logoSrc={logoSrc} className={className} />;
  }
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface ps-0.5 pe-2.5 text-sm font-medium text-text",
        className,
      )}
    >
      <Avatar name={name} src={photoSrc} size="sm" decorative />
      <span className="truncate">{name}</span>
    </span>
  );
}
