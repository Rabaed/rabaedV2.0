"use client";

import { stepAgeLabel, type Locale, type OutcomeLook } from "@rabaed/domain";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { Icon } from "../icon/icon.tsx";
import { AgeDots } from "../status/age-dots.tsx";

/**
 * The Work Item page's own parts (RP-1151, the owner's "Rabaed Work Item Page"), beside the Submittal
 * Panel's it reuses. Presentational: the app fills them from the item, history and Workflow map
 * reads, and wires their buttons.
 */

const lookColour: Record<OutcomeLook, string> = {
  a: "bg-code-a-bg text-code-a-fg",
  b: "bg-code-b-bg text-code-b-fg",
  c: "bg-code-c-bg text-code-c-fg",
  d: "bg-code-d-bg text-code-d-fg",
};

/**
 * A Review Code's letter on a small square tile (gap table row 27), coloured by `look`, its place in its
 * Type's outcome set (`outcomeLook`, as the Kanban and the panel colour it); grey without one. Decorative:
 * the Transition's label or the card's title already says the code.
 */
export function CodeTile({ code, look, size = "sm", className }: { code: string; look?: OutcomeLook | undefined; size?: "sm" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-extrabold",
        size === "sm" ? "size-[18px] rounded-[5px] text-[11px]" : "size-[30px] rounded-[8px] text-[15px]",
        look ? lookColour[look] : "bg-surface-subtle text-text-secondary",
        className,
      )}
    >
      {code.toUpperCase()}
    </span>
  );
}

/** Step Age as a pill: the 1–4+ dots and "N weeks at this step" (gap table row 16). Never days, never a due date. */
export function StepAgePill({ weeks, locale }: { weeks: number; locale: Locale }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-[12px] font-semibold text-text-secondary shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      <AgeDots weeks={weeks} locale={locale} />
      {/* The dots already carry the words for screen readers. */}
      <span aria-hidden="true">{stepAgeLabel(weeks, locale)}</span>
    </span>
  );
}

export type WorkItemIssuedCodeCardProps = {
  code: string;
  /** The code's place in its Type's set (`outcomeLook`): its tile's colour. */
  look?: OutcomeLook | undefined;
  /** The Code's name, e.g. "Revise & Resubmit": names the card. */
  title: string;
  /** "Review Code issued · 30 Oct 2026, 10:10" */
  issued: string;
  /** The shared Remarks; none when none were written. */
  remarks?: string | null;
  /** "Signed by" */
  signedBy: string;
  /** Who signed it, by name only (V14); none when the read names nobody. */
  signer?: string | null;
  company?: string | null;
};

/**
 * The Issued Code card (gap table row 23): the code tile and its name, when it was issued,
 * the Remarks as written, and who signed it, the one person of another Company the live item names
 * (V14). The reviewer's verification note never shows here (V5).
 */
export function WorkItemIssuedCodeCard({ code, look, title, issued, remarks, signedBy, signer, company }: WorkItemIssuedCodeCardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-issued-code="" className="flex flex-col gap-2.5 rounded-[12px] bg-warning-tint p-[14px]">
      <div className="flex items-center gap-2.5">
        <CodeTile code={code} look={look} size="lg" />
        <span className="min-w-0">
          <b id={id} className="block text-[14.5px]">
            {title}
          </b>
          <small className="text-[12px] text-warning-fg">{issued}</small>
        </span>
      </div>
      {remarks && (
        <p className="flex gap-1.5 rounded-[9px] bg-surface px-3 py-2.5 text-[13.5px] leading-normal">
          <Icon name="message-circle" size={16} className="mt-0.5 shrink-0 text-muted" />
          <span dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {remarks}
          </span>
        </p>
      )}
      {signer && (
        <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <Avatar name={signer} size="sm" decorative />
          <span>
            {signedBy} <b>{signer}</b>
            {company && <small className="text-warning-fg"> · {company}</small>}
          </span>
        </p>
      )}
    </section>
  );
}

export type WorkItemTransitionsCardProps = {
  /** "Actions": names the card. */
  title: string;
  /**
   * Who it is with now: the Step, its holder as the viewer may know them (a person of their own
   * Company, a pool's names, or another Company by name only, V14), `unclaimed` while it waits in
   * the viewer's pool, a code tile once closed, and what goes at its end (Return to pool).
   */
  with: { step: string; holder: string | null; avatar?: string; unclaimed?: boolean; code?: string; look?: OutcomeLook | undefined; end?: ReactNode };
  /** The Transitions the viewer may take, stacked (the rail; the bottom bar holds them under 880px), and Pick up. */
  transitions?: ReactNode;
  /** "1 field needs your attention before sending." */
  attention?: string;
  /** What there is to do, or why nothing is: "Nothing for you to do while it is with the Consultant." */
  none?: string;
  /** The Create Revision card, after Code C for the raiser. */
  revision?: { title: string; text: string; action: ReactNode };
  /** Below the rest: Discard Revision. */
  footer?: ReactNode;
};

/** The Actions card (gap table rows 24–33): in the rail from 880px, in the flow under the key facts below it. */
export function WorkItemTransitionsCard({ title, with: holder, transitions, attention, none, revision, footer }: WorkItemTransitionsCardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-transitions-card="" className="flex flex-col gap-3 rounded-[12px] bg-surface p-[14px] shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      <h3 id={id} className="text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase rtl:tracking-normal">
        {title}
      </h3>
      <div className="flex items-center gap-2.5 rounded-[10px] bg-surface-subtle p-2.5">
        {holder.code ? (
          <CodeTile code={holder.code} look={holder.look} size="lg" />
        ) : holder.avatar ? (
          <Avatar name={holder.avatar} size="sm" decorative />
        ) : (
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface text-text-secondary">
            <Icon name="route" size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px]">{holder.step}</b>
          {holder.holder && <small className={cn("block text-[12px] text-muted", holder.unclaimed && "font-semibold text-warning-fg")}>{holder.holder}</small>}
        </span>
        {holder.end}
      </div>
      {transitions && <div className="flex flex-col gap-1.5 [&>button]:h-[38px] [&>button]:justify-start">{transitions}</div>}
      {attention && (
        <p className="flex gap-1.5 text-[12px] leading-snug font-semibold text-danger-fg">
          <Icon name="alert-circle" size={15} className="mt-px shrink-0" />
          {attention}
        </p>
      )}
      {none && <p className="text-[12.5px] leading-[1.45] text-muted">{none}</p>}
      {revision && (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-brand-tint p-3 shadow-[inset_0_0_0_1.5px_var(--brand)]">
          <b className="text-[13.5px]">{revision.title}</b>
          <p className="text-[12.5px] leading-[1.45] text-text-secondary">{revision.text}</p>
          <div className="flex">{revision.action}</div>
        </div>
      )}
      {footer}
    </section>
  );
}
