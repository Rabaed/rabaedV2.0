import type { Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import type { ReviewCode } from "../../tokens/themes.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

// Each code has its own icon, colour and meaning; B always carries the comment icon,
// because its Comments continue in the Snag List. Full class names, so Tailwind finds them.
/* eslint-disable rabaed/no-ui-translations -- a documented exception in packages/ui/README.md (the Review Code meanings) */
const codes: Record<ReviewCode, { icon: IconName; colour: string; meaning: Record<Locale, string> }> = {
  a: { icon: "circle-check", colour: "bg-code-a-bg text-code-a-fg", meaning: { en: "Approved", ar: "معتمد" } },
  b: {
    icon: "message-circle",
    colour: "bg-code-b-bg text-code-b-fg",
    meaning: { en: "Approved with Comments", ar: "معتمد مع ملاحظات" },
  },
  c: {
    icon: "refresh",
    colour: "bg-code-c-bg text-code-c-fg",
    meaning: { en: "Revise and Resubmit", ar: "يُعدَّل ويُعاد تقديمه" },
  },
  d: { icon: "circle-x", colour: "bg-code-d-bg text-code-d-fg", meaning: { en: "Rejected", ar: "مرفوض" } },
};
/* eslint-enable rabaed/no-ui-translations */

const sizes = {
  sm: { box: "h-5 gap-1 px-1.5 text-notes", icon: 14 },
  md: { box: "h-6 gap-1.5 px-2 text-caption", icon: 16 },
};

export type CodeBadgeProps = {
  /** The Review Code: `a`, `b`, `c` or `d`. */
  code: ReviewCode;
  /** The language of the code's meaning. */
  locale: Locale;
  /** 20 or 24px (default) tall. */
  size?: keyof typeof sizes;
  /** `full` (default): the letter and its meaning. `letter`: the letter only, with the meaning for screen readers. */
  variant?: "full" | "letter";
  className?: string;
};

/**
 * A Review Code: A Approved (green), B Approved with Comments (green, with the
 * comment icon), C Revise and Resubmit (orange), D Rejected (red). Icon, colour
 * and text together, so colour is never the only cue.
 */
export function CodeBadge({ code, locale, size = "md", variant = "full", className }: CodeBadgeProps) {
  const { icon, colour, meaning } = codes[code];
  return (
    <span
      data-code={code}
      className={cn("inline-flex items-center rounded-full font-semibold whitespace-nowrap", colour, sizes[size].box, className)}
    >
      <Icon name={icon} size={sizes[size].icon} data-icon={icon} />
      <span translate="no">{code.toUpperCase()}</span>
      <span className={cn(variant === "letter" && "sr-only")}>{meaning[locale]}</span>
    </span>
  );
}
