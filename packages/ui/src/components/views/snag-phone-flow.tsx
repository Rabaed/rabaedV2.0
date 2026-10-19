"use client";

import type { BilingualText, Locale } from "@rabaed/domain";
import { useId, useRef, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, buttonVariants } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Input } from "../form/input.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { TradeDot } from "./snag-phone.tsx";

// The camera-first New Snag on a phone (RP-630; design/reference/claude-design/ui_kits/app/snag-list-mobile.html,
// `snag/mobile.js`): one step a screen, each with a big button in reach of a thumb. The camera, then the
// Subject (the Draft is created here), the Location (saved to the Draft as it is picked), then Raise.
// The app runs the calls; these only show the steps.

export type SnagFlowLabels = {
  /** The camera's heading, e.g. "New Snag". */
  newSnag: string;
  /** Under each heading, e.g. "Step 2 of 4". */
  stepOf: (n: string, of: string) => string;
  back: string;
  cancel: string;
  /** Once the Draft exists, and each time it is saved. */
  draftSaved: string;
  saving: string;
  next: string;
  camera: {
    takePhoto: string;
    library: string;
    /** "Next" without a photo. */
    skip: string;
    /** In the empty viewfinder. */
    pointAt: string;
    remove: (name: string) => string;
  };
  subject: {
    heading: string;
    subject: string;
    placeholder: string;
    description: string;
    trade: string;
  };
  location: {
    heading: string;
    /** The breadcrumb's start, back to the Zones. */
    allZones: string;
    hint: string;
  };
  raise: {
    heading: string;
    raise: string;
    /** Raise is not offered to the viewer on this Draft now (two Contractors cover it, say). */
    notOffered: string;
    openDraft: string;
  };
};

export type FlowPhoto = { id: string; url: string | null; name: string };

/** The frame of the steps after the camera: back, the heading and its step, "Draft saved", the step, and its big button at the bottom. */
export function SnagFlowFrame({
  heading,
  step,
  steps,
  labels,
  back,
  saved,
  footer,
  children,
}: {
  heading: string;
  /** 1-based. */
  step: number;
  steps: number;
  labels: SnagFlowLabels;
  back: ReactNode;
  /** "Draft saved", "Saving…", or nothing before the Draft exists. */
  saved?: "saved" | "saving";
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="snag-flow-heading" className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-md flex-col gap-4 pb-28">
      <header className="flex items-center gap-3">
        {back}
        <div className="min-w-0 flex-1">
          <h1 id="snag-flow-heading" className="text-[17px] font-bold text-text">
            {heading}
          </h1>
          <p className="sr-only">{labels.stepOf(String(step), String(steps))}</p>
          <div aria-hidden="true" className="mt-1 flex gap-1">
            {Array.from({ length: steps }, (_, i) => (
              <span key={i} className={cn("h-1 w-[22px] rounded-full", i < step ? "bg-primary" : "bg-border")} />
            ))}
          </div>
        </div>
        {saved && (
          <span role="status" className={cn("inline-flex items-center gap-1 text-[11.5px] font-semibold whitespace-nowrap", saved === "saved" ? "text-success-fg" : "text-muted")}>
            {saved === "saved" && <Icon name="check" size={14} />}
            {saved === "saved" ? labels.draftSaved : labels.saving}
          </span>
        )}
      </header>
      {children}
      {/* eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
    </section>
  );
}

/** The back button of a step: a link, or a button. */
export function SnagFlowBack({ label, href, onClick, linkAs: Link = "a" }: { label: string; href?: string; onClick?: () => void; linkAs?: ElementType }) {
  const look = cn("inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface-subtle text-text", focusRing);
  const icon = <Icon name="arrow-left" size={20} label={label} />;
  return href ? (
    <Link href={href} className={look}>
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={look}>
      {icon}
    </button>
  );
}

const bigButton = "h-12 flex-1 text-[15px]";

/** Step 1: the camera. The shutter opens the phone's camera; the library its photos. The photos are kept in the page until the Draft exists. */
export function SnagCameraStep({
  photos,
  labels,
  cancelHref,
  linkAs: Link = "a",
  onAdd,
  onRemove,
  onNext,
}: {
  photos: readonly FlowPhoto[];
  labels: SnagFlowLabels;
  cancelHref: string;
  linkAs?: ElementType;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onNext: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const id = useId();
  const take = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length > 0) onAdd(files);
  };
  const latest = photos.at(-1);
  const round = "flex size-12 items-center justify-center rounded-[14px] bg-on-inverse/15";
  return (
    <section aria-labelledby={`${id}-heading`} className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.5rem)] flex-col bg-inverse text-on-inverse">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <Link href={cancelHref} className={cn("inline-flex size-11 items-center justify-center rounded-full bg-on-inverse/15", focusRing)}>
          <Icon name="x" size={20} label={labels.cancel} />
        </Link>
        <h1 id={`${id}-heading`} className="text-[15px] font-semibold">
          {labels.newSnag}
          <span className="sr-only"> · {labels.stepOf("1", "4")}</span>
        </h1>
        <span className="size-11" />
      </div>
      <div className="relative mx-4 mt-3 flex min-h-[18rem] flex-1 items-center justify-center overflow-hidden rounded-[20px] bg-on-inverse/10">
        {latest?.url ? (
          <img src={latest.url} alt={latest.name} className="absolute inset-0 size-full object-cover" />
        ) : (
          <p className="flex flex-col items-center gap-2 text-[15px] font-semibold text-on-inverse/80">
            <Icon name="camera" size={32} />
            {labels.camera.pointAt}
          </p>
        )}
      </div>
      {photos.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto px-4 pt-3">
          {photos.map((p) => (
            <li key={p.id} className="relative size-16 shrink-0 overflow-hidden rounded-[10px] bg-on-inverse/10">
              {p.url && <img src={p.url} alt={p.name} className="size-full object-cover" />}
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className={cn("absolute end-0 top-0 inline-flex size-11 items-start justify-end p-1", focusRing)}
              >
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-inverse/80">
                  <Icon name="x" size={14} label={labels.camera.remove(p.name)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name */}
      <div className="grid grid-cols-3 items-center px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => library.current?.click()} className={cn("flex flex-col items-center gap-1 justify-self-start rounded-md text-caption font-semibold", focusRing)}>
          <span className={round}>
            <Icon name="photo" size={22} />
          </span>
          {labels.camera.library}
        </button>
        <button type="button" onClick={() => camera.current?.click()} className={cn("justify-self-center rounded-full", focusRing)}>
          <span className="flex size-[72px] items-center justify-center rounded-full border-4 border-on-inverse">
            <span className="size-14 rounded-full bg-on-inverse" />
          </span>
          <span className="sr-only">{labels.camera.takePhoto}</span>
        </button>
        <button type="button" onClick={onNext} className={cn("flex flex-col items-center gap-1 justify-self-end rounded-md text-caption font-semibold", focusRing)}>
          <span className={round}>
            <Icon name="arrow-right" size={22} />
          </span>
          {photos.length > 0 ? labels.next : labels.camera.skip}
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.currentTarget)} />
      <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => take(e.currentTarget)} />
    </section>
  );
}

export type SubjectAnswers = { subject: string; description: string; trade: string | null };

/** Step 2: what is wrong. The Subject, the Description when the Form asks one, and the Trade (picked already when the viewer covers one). */
export function SnagSubjectStep({
  photos,
  value,
  onChange,
  trades,
  askDescription,
  errors,
  locale,
  labels,
}: {
  photos: readonly FlowPhoto[];
  value: SubjectAnswers;
  onChange: (value: SubjectAnswers) => void;
  trades: readonly { id: string; code: string; name: BilingualText }[];
  askDescription: boolean;
  /** Each field's message, from the checks the server runs too. */
  errors: Partial<Record<"subject" | "description" | "trade", string>>;
  locale: Locale;
  labels: SnagFlowLabels;
}) {
  const first = photos[0];
  const tradeLabel = useId();
  return (
    <div className="flex flex-col gap-4">
      {first?.url && (
        <span className="relative block h-[120px] overflow-hidden rounded-[12px] bg-surface-subtle">
          <img src={first.url} alt={first.name} className="size-full object-cover" />
        </span>
      )}
      <Field label={labels.subject.subject} required error={errors.subject}>
        <Input value={value.subject} maxLength={200} dir="auto" placeholder={labels.subject.placeholder} onChange={(e) => onChange({ ...value, subject: e.target.value })} />
      </Field>
      {askDescription && (
        <Field label={labels.subject.description} required error={errors.description}>
          <Textarea value={value.description} dir="auto" rows={3} onChange={(e) => onChange({ ...value, description: e.target.value })} />
        </Field>
      )}
      <div role="radiogroup" aria-labelledby={tradeLabel} aria-required="true" aria-invalid={errors.trade ? true : undefined} className="flex flex-col gap-2">
        <span id={tradeLabel} className="text-sm font-semibold text-text">
          {labels.subject.trade}
        </span>
        <div className="flex flex-wrap gap-2">
          {trades.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={value.trade === t.id}
              onClick={() => onChange({ ...value, trade: t.id })}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-surface-subtle px-3 text-[14px] font-semibold text-text-secondary aria-checked:border-primary aria-checked:bg-brand-tint aria-checked:text-brand-fg",
                focusRing,
              )}
            >
              <TradeDot code={t.code} />
              {t.name[locale]}
            </button>
          ))}
        </div>
        {errors.trade && <p className="text-sm text-danger-fg">{errors.trade}</p>}
      </div>
    </div>
  );
}

type Place = { id: string; name: BilingualText };

/** Step 3: where it is. The path picked so far, and the places inside it: Zone, then Building, then Floor. */
export function SnagLocationStep({
  path,
  choices,
  picked,
  onPick,
  locale,
  labels,
}: {
  /** From the Zone down to the place picked. */
  path: readonly Place[];
  /** The places inside the last of `path` (the Zones when nothing is picked). */
  choices: readonly Place[];
  picked: string | undefined;
  /** A place picked, or `null` for all the Zones again. */
  onPick: (id: string | null) => void;
  locale: Locale;
  labels: SnagFlowLabels;
}) {
  const crumb = cn("inline-flex min-h-11 items-center rounded-sm px-1 text-[14px] font-semibold text-brand-fg", focusRing);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={labels.location.heading}>
        <ol className="flex flex-wrap items-center gap-1 text-muted">
          <li>
            <button type="button" onClick={() => onPick(null)} className={crumb}>
              {labels.location.allZones}
            </button>
          </li>
          {path.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <Icon name={locale === "ar" ? "chevron-left" : "chevron-right"} size={14} />
              <button type="button" aria-current={p.id === picked ? "location" : undefined} onClick={() => onPick(p.id)} className={cn(crumb, "aria-[current=location]:text-text")}>
                {p.name[locale]}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              className={cn("inline-flex min-h-12 items-center gap-2 rounded-[12px] border border-border bg-surface-subtle px-4 text-[15px] font-semibold text-text", focusRing)}
            >
              <Icon name="map-pin" size={16} className="text-muted" />
              {c.name[locale]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-caption text-muted">{labels.location.hint}</p>
    </div>
  );
}

/** Step 4: the Draft as it will be raised, and Raise when the viewer is offered it. */
export function SnagRaiseStep({
  photo,
  subject,
  place,
  trade,
  offered,
  labels,
}: {
  photo: FlowPhoto | undefined;
  subject: string;
  place: string | null;
  trade: string;
  offered: boolean;
  labels: SnagFlowLabels;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-[16px] bg-surface p-2.5 ring-1 ring-border-subtle ring-inset">
        <span className="relative flex size-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-surface-subtle text-faint">
          {photo?.url ? <img src={photo.url} alt={photo.name} className="absolute inset-0 size-full object-cover" /> : <Icon name="photo" size={22} />}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p dir="auto" className="text-[15px] leading-[1.3] font-bold text-text">
            {subject}
          </p>
          {place && <p className="text-caption text-text-secondary">{place}</p>}
          <p className="text-caption text-muted">{trade}</p>
        </div>
      </div>
      {!offered && (
        <p role="note" className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
          {labels.raise.notOffered}
        </p>
      )}
    </div>
  );
}

/** A step's big button at the bottom: a link styled as the primary button. */
export function SnagFlowLink({ href, children, linkAs: Link = "a", variant = "primary" }: { href: string; children: ReactNode; linkAs?: ElementType; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant }), bigButton)}>
      {children}
    </Link>
  );
}

/** A step's big button at the bottom. */
export function SnagFlowButton({ onClick, disabled, children, variant = "primary" }: { onClick: () => void; disabled?: boolean; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Button variant={variant} disabled={disabled} aria-busy={disabled || undefined} onClick={onClick} className={bigButton}>
      {children}
    </Button>
  );
}
