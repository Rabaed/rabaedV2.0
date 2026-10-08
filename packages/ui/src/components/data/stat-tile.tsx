import { formatNumber, type Locale } from "@rabaed/domain";
import type { Tone } from "../../tokens/themes.ts";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { toneClasses } from "./tone.ts";

export type StatTileProps = {
  /** What is counted, e.g. "Active Projects". */
  label: string;
  value: number;
  icon: IconName;
  /** The icon tile's tint. */
  tone?: Tone;
  locale: Locale;
  className?: string;
};

/**
 * One count on a card: an icon on a tinted tile, the number (Latin digits) and
 * what it counts, e.g. Home's Active Projects (RP-407). The label is read with
 * the number, so a screen reader hears "12 Active Projects".
 */
export function StatTile({ label, value, icon, tone = "neutral", locale, className }: StatTileProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-surface px-5 py-4.5", className)}>
      <span aria-hidden="true" className={cn("inline-flex size-10 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon name={icon} size={22} />
      </span>
      <p className="flex flex-col gap-0.5">
        <span className="text-h4 font-bold tabular-nums">{formatNumber(value, locale)}</span>
        <span className="text-sm text-muted">{label}</span>
      </p>
    </div>
  );
}
