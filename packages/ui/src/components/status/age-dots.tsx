import type { Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { ageDotCount, stepAgeLabel } from "./step-age.ts";

// One colour per filled dot count, grey turning red; full class names, so Tailwind finds them.
const filled = ["", "bg-age-1", "bg-age-2", "bg-age-3", "bg-age-4"];

export type AgeDotsProps = {
  /** Whole weeks the Work Item has sat at its current Step: 0, 1, 2, 3, 4 or more. */
  weeks: number;
  /** The language of the spoken label. */
  locale: Locale;
  className?: string;
};

/**
 * Step Age: one dot per whole week at the current Step, up to 4 (4+), grey
 * turning red. An image named "N weeks at this step", so colour is never the
 * only cue. Rabaed shows age only.
 */
export function AgeDots({ weeks, locale, className }: AgeDotsProps) {
  const dots = ageDotCount(weeks);
  const label = stepAgeLabel(weeks, locale);
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex items-center gap-1", className)}>
      {[1, 2, 3, 4].map((i) =>
        i <= dots ? (
          <span key={i} data-filled="" className={cn("size-2 rounded-full", filled[dots])} />
        ) : (
          <span key={i} className="size-2 rounded-full border border-age-0" />
        ),
      )}
    </span>
  );
}
