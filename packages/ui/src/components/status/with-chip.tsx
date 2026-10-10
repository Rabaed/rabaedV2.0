import { cn } from "../../lib/cn.ts";
import { Avatar, Chip, CompanyChip } from "../data/avatar.tsx";

type HolderCompany = {
  /** The holder's Company name. */
  companyName: string;
  /** The Company's logo, from our own origin. */
  logoSrc?: string;
};

/** No person: nothing that says who they are. */
type NoPerson = { name?: never; photoSrc?: never };

/**
 * Who holds the current Step. A `person` in the viewer's own Company carries
 * their `name` and `photoSrc`; any holder in another Company, and a `company`
 * as a whole (nobody has picked up the Step yet), carries its Company only
 * (visibility V14). Passing another Company's person's name fails the typecheck.
 */
export type WithChipHolder =
  | (HolderCompany & {
      kind: "person";
      inViewerCompany: true;
      /** The person's display name. */
      name: string;
      /** The person's photo, from our own origin. */
      photoSrc?: string;
    })
  | (HolderCompany & NoPerson & { kind: "person"; inViewerCompany: false })
  | (HolderCompany & NoPerson & { kind: "company"; inViewerCompany: boolean })
  | (HolderCompany &
      NoPerson & {
        /** A Step of the viewer's own Company that nobody has picked up yet: "<Step> · not picked up". */
        kind: "pool";
        inViewerCompany: true;
        /** The Step's name. */
        stepName: string;
        /** "not picked up", in the viewer's language. */
        notPickedUpLabel: string;
      });

export type WithChipProps = WithChipHolder & { className?: string };

/**
 * Who a Work Item is with: the "With" cell of a list, a Kanban card, a stepper.
 * A person in the viewer's own Company is shown by name; anyone else as their
 * Company's name only (V14). A name or photo forced through with a cast is
 * dropped here, but the API must still never send another Company's person:
 * a client component's props travel in the page payload.
 */
export function WithChip(props: WithChipProps) {
  const { companyName, logoSrc, className } = props;
  // Defence in depth: checks the values, not only the types, in case a caller casts.
  if (props.kind === "pool" && props.inViewerCompany === true) {
    return (
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-body", className)}>
        {props.stepName} <span className="text-muted">· {props.notPickedUpLabel}</span>
      </span>
    );
  }
  if (props.inViewerCompany !== true || props.kind !== "person" || !props.name) {
    return <CompanyChip name={companyName} logoSrc={logoSrc} className={className} />;
  }
  const { name, photoSrc } = props;
  return <Chip avatar={<Avatar name={name} src={photoSrc} size="sm" decorative />} name={name} className={className} />;
}
