"use client";

import { directionOf, formatNumber, type BaseRole, type BilingualText, type DraftsVisibleTo, type Locale } from "@rabaed/domain";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, buttonVariants } from "../button/button.tsx";
import { Avatar } from "../data/avatar.tsx";
import { focusRing, touchArea } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { newItemRequired, newItemRouteRows, newItemTypeIcon, type NewItemRequiredItem } from "./new-item-model.ts";
import type { SubmittalRoute } from "./route-model.ts";
import { RoleIcon } from "./route-strip.tsx";

// The Submittal Panel's create mode (RP-1152): the parts a new item is raised with, each taking its
// words from the caller and its data as domain types. Nothing here fetches. Each part is optional,
// so a shorter Form (RP-1221 Inspections, RP-1222 Snags) uses only the ones it needs.

/** The small uppercase heading of a rail block; plain words inside "Before you send". */
const blockHeading =
  "flex items-center gap-2 text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase rtl:tracking-normal in-[.sdp-before]:text-[12px] in-[.sdp-before]:font-normal in-[.sdp-before]:tracking-normal in-[.sdp-before]:normal-case";

/** A Type the Member may raise, as `raisable-types` gives it; its one-line description when it has one (row 18). */
export type NewItemType = { code: string; name: BilingualText; description?: BilingualText | null };

export type NewItemTypeCardsProps = {
  locale: Locale;
  /** "The Types you may raise". */
  heading: string;
  types: readonly NewItemType[];
  /** The chosen Type's code. */
  value: string | null;
  onChange: (code: string) => void;
  className?: string;
};

/**
 * The Type cards (rows 17–19, decision 2, `.nwtype`): one per Type, its own icon (RP-1227), its
 * name with the code, the one-line description, and a check on the chosen one. With one Type, a
 * single chosen card.
 */
export function NewItemTypeCards({ locale, heading, types, value, onChange, className }: NewItemTypeCardsProps) {
  const headingId = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p id={headingId} className="text-[12px] text-muted">
        {heading}
      </p>
      {/* `.nwtype` (RP-1227): the cards wrap in a row, each at least 240px; under 560px of panel width, one full-width stack. */}
      <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {types.map((type) => {
          const on = type.code === value;
          return (
            <button
              key={type.code}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(type.code)}
              className={cn(
                "flex min-h-11 min-w-[240px] items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-start @max-[560px]/sdp:w-full @max-[560px]/sdp:min-w-0",
                on ? "bg-brand-tint shadow-[inset_0_0_0_1.5px_var(--brand)]" : "bg-surface shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-hover",
                focusRing,
              )}
            >
              <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-surface text-brand-fg shadow-[inset_0_0_0_1px_var(--border-subtle)]">
                <Icon name={newItemTypeIcon(type.code)} size={16} />
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold">
                  {type.name[locale]} (<bdi dir="ltr">{type.code}</bdi>)
                </b>
                {type.description && <small className="block text-[11.5px] text-muted">{type.description[locale]}</small>}
              </span>
              <Icon name="circle-check" size={18} className={cn("ms-auto text-brand-fg", !on && "invisible")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type NewItemIdentityProps = {
  /** The page's language: the Subject reads in its direction while empty. */
  locale: Locale;
  /** "No number yet": a Draft has no Document Number. */
  noNumber: string;
  /** The Draft chip's word. */
  draft: string;
  subject: string;
  onSubjectChange: (subject: string) => void;
  /** The Subject input's accessible name, "Subject". */
  subjectLabel: string;
  /** "Subject *  e.g. …". */
  placeholder?: string;
  /** The ids the panel is named by (`useSubmittalPanelIds`). */
  numberId?: string;
  /** Marks the Subject as missing. */
  invalid?: boolean;
  /** The Subject is set once the Draft exists (no call changes it): it reads, and can't be typed in. */
  readOnly?: boolean;
  /** Focus the Subject when it shows: a form that clears after each save (RP-1222 row 10) is ready for the next one. */
  focusSubject?: boolean;
  children?: ReactNode;
};

/** A Subject's longest length, as the create call allows. */
export const newItemSubjectMaxLength = 200;

/**
 * The new item's identity (rows 15, 16, `.did`, `.nwsub`): "No number yet" and the Draft chip from
 * the start, then the large Subject input (at most 200 characters). The Type cards and the banner
 * go under it as `children`.
 */
export function NewItemIdentity({ locale, noNumber, draft, subject, onSubjectChange, subjectLabel, placeholder, numberId, invalid, readOnly, focusSubject = false, children }: NewItemIdentityProps) {
  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSubject) subjectRef.current?.focus();
  }, [focusSubject]);
  return (
    <div className="sdp-identity flex flex-col gap-2 px-5 pt-[18px] pb-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <p id={numberId} className="sdp-number text-[26px] leading-[1.1] font-extrabold text-muted">
          {noNumber}
        </p>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-[12px] font-semibold text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-[var(--muted)]" />
          {draft}
        </span>
      </div>
      <input
        ref={subjectRef}
        type="text"
        // The page's direction while empty (the placeholder starts at the right in Arabic); typed text takes its own from its first letter (`plaintext`).
        dir={directionOf(locale)}
        value={subject}
        onChange={(event) => onSubjectChange(event.target.value)}
        maxLength={newItemSubjectMaxLength}
        aria-label={subjectLabel}
        aria-required="true"
        aria-invalid={invalid || undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn(
          "sdp-new-subject my-1 min-h-11 w-full rounded-[10px] text-start [unicode-bidi:plaintext] bg-transparent px-2.5 py-1.5 text-[20px] font-bold tracking-[-0.01em] text-text shadow-[inset_0_0_0_1px_var(--border-strong)] outline-none @[880px]/sdp:text-[24px]",
          "placeholder:font-semibold placeholder:text-muted focus:shadow-[inset_0_0_0_1.5px_var(--brand)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--danger-fg)]",
        )}
      />
      {children}
    </div>
  );
}

export type DraftWhoSeesLabels = {
  /** "Only you see this Draft until it is Submitted." */
  author: string;
  /** "Only your Company sees this Draft until it is Submitted." */
  company: string;
  /** The box's heading, "Who sees this Draft". */
  heading?: string;
};

export type DraftWhoSeesProps = {
  /** The banner under the Type (`.nwprv`), or the rail's box (`.nwwho`). */
  look: "banner" | "box";
  /** The Draft Step's "Drafts visible to"; unset reads as company. */
  draftsVisibleTo: DraftsVisibleTo | null;
  /** The viewer's own Company, which the box names. Never another Company's (V15). */
  companyName: string;
  companyLogo?: string;
  labels: DraftWhoSeesLabels;
  className?: string;
};

/**
 * Who sees this Draft (rows 20, 21, decision 4): "Only you" or "Only your Company", as the Draft
 * Step's setting says. Other Companies never see a Draft (V1), and none is named here (V15).
 */
export function DraftWhoSees({ look, draftsVisibleTo, companyName, companyLogo, labels, className }: DraftWhoSeesProps) {
  const text = draftsVisibleTo === "author" ? labels.author : labels.company;
  if (look === "banner") {
    return (
      <p data-draft-who-sees="" className={cn("flex items-start gap-2 rounded-[10px] bg-warning-tint px-3 py-2.5 text-[12.5px] leading-[1.4] font-semibold text-warning-fg", className)}>
        <Icon name="lock" size={15} className="mt-px" />
        {text}
      </p>
    );
  }
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      {labels.heading && <h3 className={blockHeading}>{labels.heading}</h3>}
      <div data-draft-who-sees="" className="flex items-center gap-2.5 rounded-[10px] bg-surface p-2.5 text-[12.5px] leading-[1.4] shadow-[inset_0_0_0_1px_var(--border-subtle)]">
        <Avatar name={companyName} src={companyLogo} kind="company" decorative />
        <span className="min-w-0">
          <b className="block text-[13px] font-semibold">{companyName}</b>
          <span className="text-muted">{text}</span>
        </span>
      </div>
    </section>
  );
}

export type RequiredChecklistProps = {
  locale: Locale;
  /** "Required before Send for Review". */
  heading: string;
  /** The Form's required fields, in its order, each filled or not. */
  items: readonly NewItemRequiredItem[];
  /** "A Draft can be saved incomplete. You send it from the Work Item page."; left out, no line. */
  incomplete?: string;
  className?: string;
};

/** The checklist of what the Form requires before Send for Review (rows 25, 33, `.nwchk`), with "n/m". */
export function RequiredChecklist({ locale, heading, items, incomplete, className }: RequiredChecklistProps) {
  const headingId = useId();
  const { done, total } = newItemRequired(items);
  return (
    <section className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <h3 className={blockHeading}>
        {/* The list is named by the heading's words, not its count. */}
        <span id={headingId} className="me-auto">
          {heading}
        </span>
        <span className="text-text tabular-nums in-[.sdp-before]:hidden">
          <bdi dir="ltr">
            {formatNumber(done, locale)}/{formatNumber(total, locale)}
          </bdi>
        </span>
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-[7px]">
        {items.map((item) => (
          <li key={item.key} data-done={item.done || undefined} className={cn("flex items-center gap-2 text-[13px]", item.done && "text-muted")}>
            <Icon name={item.done ? "circle-check" : "circle-dashed"} size={17} className={item.done ? "text-success" : "text-faint"} />
            {item.label}
          </li>
        ))}
      </ul>
      {incomplete && <p className="text-[12.5px] leading-[1.45] text-muted">{incomplete}</p>}
    </section>
  );
}

export type NewItemRoutePreviewLabels = {
  /** A Project Role, e.g. "Contractor". */
  role: (role: BaseRole) => string;
  /** The preview's name, "Workflow after you send". */
  route: string;
  /** The viewer's current Step's line, "Now · you". */
  now: string;
  /** Another role's stop, e.g. "Consultant review". */
  review: (role: BaseRole) => string;
  /** Under it: "Steps inside are private". */
  private: string;
  /** The closing stop, "Close or Revise". */
  outcome: string;
};

export type NewItemRoutePreviewProps = {
  locale: Locale;
  /** The route from the Type's Workflow, computed with the Draft Step as the viewer's own position (`submittalRoute`). */
  route: SubmittalRoute;
  labels: NewItemRoutePreviewLabels;
  /** A heading over it, e.g. "Workflow after you send"; none by default. */
  heading?: string;
  className?: string;
};

/**
 * The route a new item will take (rows 34, 35, decision 3, `.droute` and `.dwf`): the role chips,
 * then the Step list. The viewer's own Company's Steps by name, the current one "Now · you" and
 * later ones by role; every other role's stop one row, its Steps private; the outcome by role.
 * Never a person's name, never a Company's (V15).
 */
export function NewItemRoutePreview({ locale, route, labels, heading, className }: NewItemRoutePreviewProps) {
  const rows = newItemRouteRows(route);
  const firstCurrent = route.stops.findIndex((s) => s.state === "current");
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      {heading && <h3 className={blockHeading}>{heading}</h3>}
      <ol aria-label={labels.route} className="flex w-full flex-wrap items-center gap-1 rounded-[12px] bg-surface-subtle p-2 shadow-[inset_0_0_0_1px_var(--border-subtle)] in-[.sdp-before]:hidden">
        {route.stops.map((stop, i) => (
          <li key={i} aria-current={i === firstCurrent ? "step" : undefined} className="flex min-w-0 items-center gap-1">
            {i > 0 && <Icon name="chevron-right" size={13} className="shrink-0 text-faint" />}
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-[9px] py-[3px] ps-[3px] pe-2 text-[12px] font-semibold",
                i === firstCurrent ? "bg-surface shadow-[0_0_0_1.5px_var(--brand)]" : "text-muted [&_.sdp-role]:opacity-55",
              )}
            >
              <RoleIcon role={stop.role} size={24} />
              {labels.role(stop.role)}
            </span>
          </li>
        ))}
      </ol>
      <ol className="flex flex-col">
        {rows.map((row, i) => {
          const last = i === rows.length - 1;
          const current = row.kind === "step" && row.current;
          const title = row.kind === "step" ? row.name[locale] : row.kind === "private" ? labels.review(row.role) : labels.outcome;
          const line = current ? labels.now : row.kind === "private" ? labels.private : labels.role(row.role);
          return (
            <li key={i} data-route-row={row.kind} aria-current={current ? "step" : undefined} className={cn("relative grid grid-cols-[20px_minmax(0,1fr)] gap-2.5", !last && "pb-[14px]")}>
              {!last && <span aria-hidden="true" className="absolute start-[9px] top-5 bottom-0 w-0.5 bg-border-subtle" />}
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex size-5 items-center justify-center bg-surface",
                  // Another role's stop is a square: its Steps are private.
                  row.kind === "private" ? "rounded-[6px]" : "rounded-full",
                  current ? "shadow-[inset_0_0_0_2px_var(--brand)]" : "shadow-[inset_0_0_0_2px_var(--border-strong)]",
                )}
              >
                {current && <span className="size-2 rounded-full bg-brand" />}
              </span>
              <span className="min-w-0">
                <b dir="auto" className="flex items-center gap-1.5 text-[13px] leading-5 font-semibold">
                  <RoleIcon role={row.role} size={18} />
                  {title}
                </b>
                <small className={cn("block text-[12px] text-muted", row.kind === "private" && "italic")}>{line}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export type BeforeYouSendProps = {
  /** "Before you send". */
  heading: string;
  /** The required checklist (`RequiredChecklist`). */
  checklist?: ReactNode;
  /** The route preview (`NewItemRoutePreview`); none for a Form whose route isn't previewed. */
  route?: ReactNode;
  /** Unfolded, when the caller controls it; left out, the block opens and closes on its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** True (default): hidden from the Wide band, where the rail shows the same. False: always in the flow, for a panel with no rail (`rail={false}`). */
  inflow?: boolean;
  className?: string;
};

/**
 * "Before you send" (row 12): the rail's checklist and route in the flow, above the Form Sections,
 * where the rail is hidden (Normal, Compact, the tablet and the phone). A panel block, not a Form
 * Section, so "Collapse all" leaves it alone: from the Wide band the rail shows them and this block
 * hides (`.sdp-inflow`), unless the panel has no rail (`inflow={false}`).
 */
export function BeforeYouSend({ heading, checklist, route, open: controlled, onOpenChange, inflow = true, className }: BeforeYouSendProps) {
  const [own, setOwn] = useState(true);
  const open = controlled ?? own;
  const bodyId = useId();
  const toggle = () => {
    setOwn(!open);
    onOpenChange?.(!open);
  };
  return (
    <section data-before-you-send="" className={cn("sdp-before rounded-[12px]", inflow && "sdp-inflow", "bg-surface shadow-[inset_0_0_0_1px_var(--border-subtle)]", className)}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={toggle}
          className={cn("flex min-h-12 w-full items-center gap-2.5 rounded-[12px] px-3 text-start hover:bg-hover", focusRing, "focus-visible:-outline-offset-2", open && "rounded-b-none")}
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-subtle text-text-secondary">
            <Icon name="route" size={15} />
          </span>
          <span className="text-[14px] font-semibold">{heading}</span>
          <Icon name="chevron-down" size={16} className={cn("ms-auto shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="grid grid-cols-1 gap-5 ps-[50px] pe-4 pt-0.5 pb-4 @max-[479px]/sdp:ps-4 @[560px]/sdp:grid-cols-2">
          {checklist}
          {route}
        </div>
      )}
    </section>
  );
}

export type NewItemSectionBarProps = {
  locale: Locale;
  /** How many Form Sections the Form has. */
  sections: number;
  /** How many of its required fields are filled (`newItemRequired`). */
  required: { done: number; total: number };
  labels: {
    /** "5 Form Sections · 0/7 required filled", from the formatted numbers. */
    summary: (sections: string, done: string, total: string) => string;
    collapseAll: string;
    expandAll: string;
  };
  /** Every Form Section is folded: the button unfolds them. */
  allCollapsed: boolean;
  onToggleAll: () => void;
};

/** The bar over the Form Sections (row 23, `.nwreq`): how many, how many required are filled, and Collapse all / Expand all. */
export function NewItemSectionBar({ locale, sections, required, labels, allCollapsed, onToggleAll }: NewItemSectionBarProps) {
  const n = (value: number) => formatNumber(value, locale);
  return (
    <div className="sdp-section-controls flex items-center gap-1.5 px-5 pt-3 pb-2 text-[12px] text-muted @[880px]/sdp:px-7">
      <span className="me-auto font-semibold">{labels.summary(n(sections), n(required.done), n(required.total))}</span>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[12.5px]" onClick={onToggleAll}>
        <Icon name={allCollapsed ? "chevron-down" : "chevron-up"} size={15} />
        {allCollapsed ? labels.expandAll : labels.collapseAll}
      </Button>
    </div>
  );
}

export type LockedDocumentsProps = {
  labels: {
    /** "Save the Draft first, then add Documents." */
    locked: string;
    /** The slot's greyed button, "Add". */
    add: string;
  };
  /** One a Documents field of the Form, in its order. */
  slots: readonly { key: string; label: string; hint?: string; icon?: IconName }[];
};

/**
 * Documents before the first save (row 29, decision 8, `.nwslot.off`): the lock line, and a greyed
 * slot for each Documents field with its label and hint. They unlock once the Draft exists.
 */
export function LockedDocuments({ labels, slots }: LockedDocumentsProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-2 rounded-[10px] bg-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-text-secondary shadow-[inset_0_0_0_1px_var(--border-subtle)]">
        <Icon name="lock" size={14} />
        {labels.locked}
      </p>
      <ul className="grid grid-cols-1 gap-2 @[560px]/sdp:grid-cols-2">
        {slots.map((slot) => (
          <li key={slot.key} data-slot={slot.key} className="flex min-w-0 items-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-border-strong px-2.5 py-2">
            {/* Greyed as the reference's `.nwslot.off`, its text kept readable. */}
            <span aria-hidden="true" className="flex h-10 w-[34px] shrink-0 items-center justify-center rounded-[6px] bg-surface-subtle text-faint">
              <Icon name={slot.icon ?? "file-text"} size={18} />
            </span>
            <span className="min-w-0 flex-1 text-muted">
              <b className="block text-[13px] font-semibold">{slot.label}</b>
              {slot.hint && <small className="text-[11.5px]">{slot.hint}</small>}
            </span>
            <Button variant="secondary" size="sm" disabled aria-label={`${labels.add} · ${slot.label}`} className="gap-1.5 px-2.5">
              <Icon name="upload" />
              <span aria-hidden="true">{labels.add}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type NewItemFooterProps = {
  /** The time of the last save as the reader reads it, e.g. "10:42"; null before the first save. */
  savedAt: string | null;
  /**
   * A form that clears after each save (the New Snag's short form, RP-1222 row 28): how many it has
   * saved since it opened, e.g. "3 Snags saved", said in place of "Not saved yet". Before the first, none.
   */
  savedCount?: string;
  /** The new item's Work Item page; shown once it is saved. */
  openHref?: string;
  onCancel?: () => void;
  onSave: () => void;
  /** A save is running: Save Draft waits. */
  saving?: boolean;
  /** The phone's page: no Cancel, the page link an icon. */
  layout?: "slide-over" | "page";
  labels: {
    /** "Not saved yet". */
    notSaved: string;
    /** "Saved 10:42". */
    saved: (time: string) => string;
    cancel: string;
    saveDraft: string;
    /** "Open Work Item page". */
    openPage: string;
  };
};

/**
 * The create panel's footer (rows 36, 38, 39, `.nwdft`), for the panel's `actions`: before the
 * first save, "Not saved yet", Cancel and Save Draft (primary, last); after it, "Saved hh:mm", the
 * Work Item page link and Save Draft as "save now". On the phone, no Cancel and the link is an icon.
 */
export function NewItemFooter({ savedAt, savedCount, openHref, onCancel, onSave, saving = false, layout = "slide-over", labels }: NewItemFooterProps) {
  const page = layout === "page";
  const saved = savedAt !== null;
  const done = saved || savedCount !== undefined;
  return (
    <>
      <span role="status" className={cn("me-auto inline-flex items-center gap-1.5 text-[12.5px] text-muted", page && "w-full")}>
        <Icon name={done ? "circle-check" : "circle-dashed"} size={15} className={done ? "text-success" : undefined} />
        <bdi>{saved ? labels.saved(savedAt) : (savedCount ?? labels.notSaved)}</bdi>
      </span>
      {!saved && !page && onCancel && (
        <Button variant="secondary" onClick={onCancel}>
          {labels.cancel}
        </Button>
      )}
      {saved && openHref && (
        <a
          href={openHref}
          aria-label={page ? labels.openPage : undefined}
          title={page ? labels.openPage : undefined}
          className={cn(buttonVariants({ variant: "ghost" }), page && "w-9 px-0 pointer-coarse:min-w-11", touchArea)}
        >
          <Icon name="external-link" />
          {!page && labels.openPage}
        </a>
      )}
      <Button onClick={onSave} disabled={saving} className={cn("min-w-[120px]", page && "flex-1")}>
        <Icon name="device-floppy" />
        {labels.saveDraft}
      </Button>
    </>
  );
}

export type DiscardDraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Discard the typed answers and close the panel. */
  onDiscard: () => void;
  labels: {
    /** "Discard this Draft?" */
    title: string;
    /** "Nothing has been saved." */
    description: string;
    discard: string;
    /** "Keep editing". */
    keep: string;
    close: string;
  };
};

/**
 * Cancel or Close with typed answers before the first save (row 37): "Discard this Draft? Nothing
 * has been saved." The caller opens it only when something was typed; otherwise it closes at once.
 */
export function DiscardDraftDialog({ open, onOpenChange, onDiscard, labels }: DiscardDraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" title={labels.title} description={labels.description} closeLabel={labels.close}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{labels.keep}</Button>
          </DialogClose>
          <Button
            variant="danger"
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
          >
            {labels.discard}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
