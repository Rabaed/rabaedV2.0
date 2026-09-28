import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import type { Tone } from "../../tokens/themes.ts";
import { toneClasses } from "./tone.ts";

export type BadgeProps = ComponentProps<"span"> & {
  /** `neutral` (default), `brand`, or a feedback tone. Stages and Review Codes have their own components. */
  tone?: Tone;
  /** A leading dot in the text colour; decorative. */
  dot?: boolean;
};

/**
 * A short label in a tinted pill: a Position, a type, a flag such as "New".
 * Its text carries the meaning, so colour is never the only cue.
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
