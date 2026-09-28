import type { Tone } from "../../tokens/themes.ts";

/** The tint and the text on it, per tone: Badge, Avatar initials and the Tabs count read them. */
export const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-tint text-neutral-fg",
  brand: "bg-brand-tint text-brand-fg",
  info: "bg-info-tint text-info-fg",
  success: "bg-success-tint text-success-fg",
  warning: "bg-warning-tint text-warning-fg",
  danger: "bg-danger-tint text-danger-fg",
};
