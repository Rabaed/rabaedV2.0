import type { BilingualText, Locale, RaisedFromSource } from "@rabaed/domain";
import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { SourceOutcomeBadge } from "./snag-list.tsx";

// The Snag item page's cards (RP-628; design/reference/claude-design/ui_kits/app/snag-list.html,
// the item detail): where it was raised from, and the Contractor's response with its "after"
// photos beside the "before" ones.

export type SnagItemLabels = {
  raisedFrom: string;
  raisedManually: string;
  open: string;
  code: (code: string) => string;
  /** Under a Comment's quoted text: whose review it came from, by role only (V14). */
  comment: string;
  response: string;
  before: string;
  after: string;
  noPhoto: string;
  photoOf: (subject: string) => string;
};

/** A photo the viewer sees: its image URL once it is fetched (null until then, or for a type the browser can't show). */
export type SnagPhoto = { id: string; url: string | null; name: string };

/**
 * One card of the item page: a small uppercase heading over its content, as a named region. The
 * reference's item cards (`.box`), lighter than TitledCard (the kit's `.pc`, a ruled 16px heading row).
 */
export function SnagItemCard({ title, icon, aside, children, className }: { title: string; icon?: IconName; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface px-4 py-3.5", className)}>
      <h2 id={id} className="flex items-center gap-1.5 text-[11.5px] font-bold text-muted uppercase">
        {icon && <Icon name={icon} size={14} />}
        {title}
        {aside && <span className="ms-auto normal-case">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Where it was raised from (the Link, read generically): the source's number and Subject, and
 * when the viewer sees it (E1) its outcome and "Open". A Comment quotes its reviewer's comment.
 * Raised by hand: says so.
 */
export function RaisedFromCard({
  source,
  quote,
  locale,
  labels,
  itemHref,
  linkAs: Link = "a",
}: {
  source: RaisedFromSource | null;
  quote?: BilingualText | string | null;
  locale: Locale;
  labels: SnagItemLabels;
  itemHref: (id: string) => string;
  linkAs?: ElementType;
}) {
  if (!source) {
    return (
      <SnagItemCard title={labels.raisedFrom}>
        <p className="text-[13px] text-muted">{labels.raisedManually}</p>
      </SnagItemCard>
    );
  }
  const text = typeof quote === "string" ? quote : quote?.[locale];
  return (
    <SnagItemCard title={labels.raisedFrom} icon="link">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-success-tint text-success-fg">
          <Icon name="file-text" size={19} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DocNo value={source.documentNumber} locale={locale} className="font-ui text-[12px] font-semibold text-muted" />
          <bdi className="text-[14px] font-semibold text-text">{source.subject}</bdi>
        </div>
        {source.outcome && <SourceOutcomeBadge outcome={source.outcome} locale={locale} code={labels.code} />}
      </div>
      {text && (
        <blockquote className="rounded-e-[8px] border-s-[3px] border-info-fg bg-info-tint px-3 py-2.5 text-[13px] leading-normal text-text">
          <bdi>“{text}”</bdi>
          <small className="mt-1.5 block text-[11.5px] text-muted">{labels.comment}</small>
        </blockquote>
      )}
      {source.workItemId && (
        <div>
          <Link href={itemHref(source.workItemId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), focusRing)}>
            <Icon name="external-link" size={15} />
            {labels.open}
          </Link>
        </div>
      )}
    </SnagItemCard>
  );
}

/** Photos as a grid of 4:3 tiles; an icon in place of one whose image isn't here. */
export function SnagPhotoGrid({ photos, labels, subject, tag }: { photos: readonly SnagPhoto[]; labels: SnagItemLabels; subject: string; tag?: string }) {
  if (photos.length === 0) {
    return <div className="flex aspect-[4/3] items-center justify-center rounded-[10px] bg-surface-subtle text-[11.5px] text-muted ring-1 ring-border-subtle ring-inset">{labels.noPhoto}</div>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
      {photos.map((p) => (
        <div key={p.id} className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[10px] bg-surface-subtle text-faint ring-1 ring-border-subtle ring-inset">
          {p.url ? (
            <img src={p.url} alt={labels.photoOf(subject)} title={p.name} className="absolute inset-0 size-full object-cover" />
          ) : (
            <Icon name="photo" size={20} label={labels.photoOf(subject)} />
          )}
          {tag && <span className="absolute start-1.5 top-1.5 rounded-[4px] bg-success-tint px-1.5 font-ui text-[10px] font-bold text-success-fg uppercase">{tag}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The Contractor's response at its Resolve: what was done, then the "after" photos beside
 * the "before" ones, so the raiser judges the fix side by side.
 */
export function SnagResponse({
  resolution,
  before,
  after,
  subject,
  labels,
  aside,
}: {
  resolution: string;
  before: readonly SnagPhoto[];
  after: readonly SnagPhoto[];
  subject: string;
  labels: SnagItemLabels;
  /** Who responded, by Company only to another Company (V14). */
  aside?: ReactNode;
}) {
  return (
    <SnagItemCard title={labels.response} icon="circle-check" aside={aside}>
      <p className="rounded-[10px] bg-segment-type-tint px-3 py-2.5 text-[13px] leading-normal whitespace-pre-line text-text">
        <bdi>{resolution}</bdi>
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <PhotoGroup label={labels.before}>
          <SnagPhotoGrid photos={before} labels={labels} subject={subject} />
        </PhotoGroup>
        <PhotoGroup label={labels.after}>
          <SnagPhotoGrid photos={after} labels={labels} subject={subject} tag={labels.after} />
        </PhotoGroup>
      </div>
    </SnagItemCard>
  );
}

function PhotoGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="text-[11.5px] font-bold text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}
