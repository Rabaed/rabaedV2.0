import { formatNumber, type Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import type { StageKey } from "../../tokens/themes.ts";

// One colour set per default Stage; full class names, so Tailwind finds them.
const colours: Record<StageKey, { pill: string; dot: string }> = {
  draft: { pill: "bg-stage-draft-bg text-stage-draft-fg", dot: "bg-stage-draft-dot" },
  internal: { pill: "bg-stage-internal-bg text-stage-internal-fg", dot: "bg-stage-internal-dot" },
  resubmitted: { pill: "bg-stage-resubmitted-bg text-stage-resubmitted-fg", dot: "bg-stage-resubmitted-dot" },
  pending: { pill: "bg-stage-pending-bg text-stage-pending-fg", dot: "bg-stage-pending-dot" },
  approved: { pill: "bg-stage-approved-bg text-stage-approved-fg", dot: "bg-stage-approved-dot" },
  rejected: { pill: "bg-stage-rejected-bg text-stage-rejected-fg", dot: "bg-stage-rejected-dot" },
  cancelled: { pill: "bg-stage-cancelled-bg text-stage-cancelled-fg", dot: "bg-stage-cancelled-dot" },
};

export type StagePillProps = {
  /** The Stage's colour category: one of the Rabaed Default Stages. */
  stage: StageKey;
  /** The Stage's name in the viewer's language, e.g. "Internal Review". */
  label: string;
  /** How many Work Items are in the Stage, e.g. on a Kanban column. */
  count?: number;
  /** The language of the count's digits (always Latin). */
  locale?: Locale;
  className?: string;
};

/**
 * A Stage, as a pill in its Stage colour with a leading dot. The name carries
 * the meaning, so colour is never the only cue.
 */
export function StagePill({ stage, label, count, locale = "en", className }: StagePillProps) {
  return (
    <span
      data-stage={stage}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold whitespace-nowrap",
        colours[stage].pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", colours[stage].dot)} />
      {label}
      {count !== undefined && <span className="font-normal tabular-nums">{formatNumber(count, locale)}</span>}
    </span>
  );
}
