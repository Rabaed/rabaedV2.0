import type { Locale } from "@rabaed/domain";
import { useId, type ElementType, type MouseEventHandler, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { ReviewCode } from "../../tokens/themes.ts";
import { Badge } from "../data/badge.tsx";
import { DocNo, type DocNoProps } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { AgeDots } from "./age-dots.tsx";
import { CodeBadge } from "./code-badge.tsx";
import { WithChip, type WithChipProps } from "./with-chip.tsx";

const densities = {
  comfortable: { card: "gap-2 p-3", title: "line-clamp-2", photo: "size-12" },
  compact: { card: "gap-1.5 px-2.5 py-2", title: "line-clamp-1", photo: "size-9" },
};

/** An open item shows who holds it and its Step Age; a closed one its Issued Code. Never both. */
export type WorkItemState =
  | {
      open: true;
      /** Who holds the current Step. Another Company's holder shows as its name only (visibility V14). */
      holder?: Omit<WithChipProps, "className">;
      /** Step Age: the week at the current Step, from 1. */
      stepAgeWeeks: number;
    }
  | {
      open: false;
      /** The Issued Code. */
      code: ReviewCode;
    };

export type WorkItemCardProps = {
  /** The Document Number, e.g. `TWR-TMC-EL-MAR-041`. */
  number: string;
  /** The revision, shown as `Rev n` after the number. */
  rev?: DocNoProps["rev"];
  title: string;
  /** The Trade's name, e.g. "Electrical". */
  trade?: string;
  /** The Location's name, e.g. "Tower 1 · Level 3". */
  location?: string;
  /** Open (holder and Step Age) or closed (Issued Code). */
  state?: WorkItemState;
  /** A photo, from our own origin: a small thumbnail at the end of the title. */
  photoSrc?: string;
  /** The language of the Step Age and Code wording. */
  locale: Locale;
  /** `comfortable` (default) or `compact`, for dense boards. */
  density?: keyof typeof densities;
  /** Where the card leads. Without it, the card is a button and `onClick` opens the item. */
  href?: string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  onClick?: MouseEventHandler<HTMLElement>;
  className?: string;
};

/**
 * A Work Item on a Kanban board, the same in every Module. The whole card is
 * one link (or button) named by its number and title; everything else on it
 * is read as its description.
 */
export function WorkItemCard({
  number,
  rev,
  title,
  trade,
  location,
  state,
  photoSrc,
  locale,
  density = "comfortable",
  href,
  linkAs: Link = "a",
  onClick,
  className,
}: WorkItemCardProps) {
  const id = useId();
  const hasPlace = trade !== undefined || location !== undefined;

  const content: ReactNode = (
    <>
      <span className="flex items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <DocNo id={`${id}-number`} value={number} rev={rev} className="text-caption text-muted" />
          <span id={`${id}-title`} data-title="" className={cn("text-body font-semibold text-text", densities[density].title)}>
            {title}
          </span>
        </span>
        {photoSrc !== undefined && (
          <img src={photoSrc} alt="" className={cn("shrink-0 rounded-xs bg-surface-subtle object-cover", densities[density].photo)} />
        )}
      </span>
      <span id={`${id}-details`} className="flex flex-col gap-2">
        {hasPlace && (
          <span className="flex min-w-0 items-center gap-2 text-caption text-muted">
            {trade !== undefined && <Badge className="shrink-0">{trade}</Badge>}
            {location !== undefined && (
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="map-pin" size={14} />
                <span className="truncate">{location}</span>
              </span>
            )}
          </span>
        )}
        {state?.open === true && (
          <span className="flex min-w-0 items-center justify-between gap-2">
            {state.holder !== undefined && <WithChip {...state.holder} className="min-w-0" />}
            <AgeDots weeks={state.stepAgeWeeks} locale={locale} className="ms-auto shrink-0" />
          </span>
        )}
        {state?.open === false && <CodeBadge code={state.code} locale={locale} size="sm" className="self-start" />}
      </span>
    </>
  );

  const shared = {
    "aria-labelledby": `${id}-number ${id}-title`,
    "aria-describedby": `${id}-details`,
    className: cn(
      "flex w-full flex-col rounded-md border border-border bg-surface text-start shadow-xs",
      "transition-colors duration-150 hover:border-border-strong hover:bg-hover",
      focusRing,
      densities[density].card,
      className,
    ),
    onClick,
  };

  return href === undefined ? (
    <button type="button" {...shared}>
      {content}
    </button>
  ) : (
    <Link href={href} {...shared}>
      {content}
    </Link>
  );
}
