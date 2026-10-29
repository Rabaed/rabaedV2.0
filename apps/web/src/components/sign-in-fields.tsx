"use client";

import type { ReactNode } from "react";
import { Button, Icon, type IconName } from "@rabaed/ui";

// The owner's sign-in design (RP-1057), shared by sign-in and the forgot password pages (RP-1058).

/**
 * 46px fields with a leading icon, 11–12px corners. The design's light outline and tomato focus ring,
 * on the sign-in pages only (owner, 2026-10-30); the rest of the app keeps the kit's darker border.
 */
export const tallInput = [
  "h-11.5 rounded-md ps-10.5 text-[14.5px] border-border hover:border-border",
  "focus-visible:outline-none focus-visible:border-brand",
  "focus-visible:shadow-[inset_0_0_0_0.5px_var(--brand),0_0_0_4px_color-mix(in_srgb,var(--brand)_15%,transparent)]",
  "aria-invalid:shadow-[inset_0_0_0_0.5px_var(--danger-fg)]",
].join(" ");

/** An email field's extra classes: an LTR address in an RTL page keeps the icon's side free and reads from the start. */
export const emailInput = `${tallInput} rtl:pe-10.5 rtl:ps-3.5 rtl:text-end`;

export function LeadingIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-faint" />;
}

/** The design's alert above the form: red for a refusal, green for "sent". */
export function FormAlert({ tone = "danger", children }: { tone?: "danger" | "success"; children: ReactNode }) {
  const toneClass = tone === "danger" ? "bg-danger-tint text-danger-fg" : "bg-success-tint text-success-fg";
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-md px-3.5 py-3 text-sm ${toneClass}`}>
      <Icon name={tone === "danger" ? "alert-circle" : "circle-check"} size={18} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The design's full-width 46px primary button, on top of the kit's: for a link styled as one, with `buttonVariants()`.
 * The design's bright tomato on the sign-in pages only (owner, 2026-10-30), not the kit's darker primary.
 */
export const tallButton =
  "h-11.5 w-full rounded-md text-[14.5px] font-semibold bg-brand text-on-primary hover:bg-brand hover:brightness-106 active:bg-brand active:brightness-95";

/** The design's links on the sign-in pages: tomato, semibold, underlined on hover. */
export const signInLink = "font-semibold text-brand hover:text-brand-fg hover:underline";

/** The full-width 46px primary button, with a spinner while busy. */
export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${tallButton} disabled:bg-brand disabled:text-on-primary disabled:opacity-70`}
    >
      {pending && <span aria-hidden="true" className="size-4.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary" />}
      {children}
    </Button>
  );
}
