import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import type { Tone } from "../../tokens/themes.ts";

/** Tint and text colour per tone; Avatar initials use the same pairs. */
export const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-tint text-neutral-fg",
  brand: "bg-brand-tint text-brand-fg",
  info: "bg-info-tint text-info-fg",
  success: "bg-success-tint text-success-fg",
  warning: "bg-warning-tint text-warning-fg",
  danger: "bg-danger-tint text-danger-fg",
};

export type BadgeProps = ComponentProps<"span"> & {
  /** `neutral` (default), `brand`, or a feedback tone. Stages and Review Codes have their own components. */
  tone?: Tone;
  /** A leading dot in the text colour; decorative. */
  dot?: boolean;
};

/**
 * A short label in a tinted pill: a role, a type, a state. Its text carries
 * the meaning, so colour is never the only cue.
 */
export function Badge({ tone = "neutral", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
