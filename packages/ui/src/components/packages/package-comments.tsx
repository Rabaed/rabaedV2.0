"use client";

import { formatNumber, type Locale, type PackageComment } from "@rabaed/domain";
import { useId, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";

// The Package page's Comments (RP-662; spec RP-616 story 35; design/prompts/packages.md
// "Comments (for information)", built in the RP-633 prototype's style): the Comments raised from
// its submittals' Code B, only those the viewer sees (`GET /v1/packages/:id/comments`). Flagged
// for information: they are not part of the Package and count in none of its counts or its status.

export type PackageCommentsLabels = {
  /** The section's heading, e.g. "Comments". */
  title: string;
  /** The flag beside it, e.g. "For information". */
  forInformation: string;
  /** "Comments are not part of the Package…" */
  notPartOf: string;
  /** When the viewer sees none. */
  empty: string;
  /** Before the submittal a Comment was raised from. */
  raisedFrom: string;
  /** A Comment still a Draft, which has no Document Number yet. */
  noNumber: string;
};

export type PackageCommentsProps = {
  comments: PackageComment[];
  locale: Locale;
  labels: PackageCommentsLabels;
  /** An item's page: a Comment's, and the submittal's it was raised from. */
  itemHref: (id: string) => string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/** A Document Number, always left to right, also in Arabic. */
function DocumentNumber({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" translate="no" className={cn("font-ui font-semibold", className)}>
      {value}
    </bdi>
  );
}

/** The Comments section: folds away under its heading; open at first. */
export function PackageComments({ comments, locale, labels, itemHref, linkAs: Link = "a" }: PackageCommentsProps) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const link = cn("rounded-xs hover:underline", focusRing);
  return (
    <section aria-labelledby={`${id}-heading`} data-package-comments="" className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h2 id={`${id}-heading`} className="text-lg font-bold text-text">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen(!open)}
            className={cn("flex items-center gap-2 rounded-xs text-start pointer-coarse:min-h-11", focusRing)}
          >
            <Icon name={open ? "chevron-down" : "chevron-right"} size={18} className={cn("text-muted", !open && "rtl:-scale-x-100")} />
            <span>{labels.title}</span>
            <span className="rounded-full bg-neutral-tint px-2 font-ui text-caption leading-5 font-semibold text-neutral-fg tabular-nums">{formatNumber(comments.length, locale)}</span>
          </button>
        </h2>
        <Badge tone="info">{labels.forInformation}</Badge>
      </div>
      <div id={`${id}-body`} hidden={!open} className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
        <p role="note" className="flex items-start gap-2 text-sm text-muted">
          <Icon name="info-circle" size={16} className="mt-0.5 shrink-0" />
          {labels.notPartOf}
        </p>
        {comments.length === 0 ? (
          <p className="text-sm text-muted">{labels.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {comments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
                <Link href={itemHref(c.id)} className={cn("flex min-w-0 flex-1 basis-72 items-baseline gap-2 text-sm text-text", link)}>
                  {c.documentNumber === null ? (
                    <span className="shrink-0 text-muted">{labels.noNumber}</span>
                  ) : (
                    <DocumentNumber value={c.documentNumber} className="shrink-0 text-text-secondary" />
                  )}
                  <span dir="auto" className="min-w-0 font-medium">
                    {c.title}
                  </span>
                </Link>
                <StagePill stage={stageColour(c.stage)} label={c.stage.name[locale]} />
                <span className="flex items-baseline gap-1.5 text-caption text-muted">
                  {labels.raisedFrom}
                  <Link href={itemHref(c.raisedFrom.id)} className={cn("text-brand-fg", link)}>
                    {c.raisedFrom.documentNumber === null ? labels.noNumber : <DocumentNumber value={c.raisedFrom.documentNumber} />}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
