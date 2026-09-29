import { stepAgeDots, type Locale } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { stepAgeLabel, wholeStepAge } from "./step-age.ts";

// One colour per filled dot count, grey turning red; full class names, so Tailwind finds them.
const filled = ["", "bg-age-1", "bg-age-2", "bg-age-3", "bg-age-4"];

export type AgeDotsProps = {
  /** Step Age: the week the Work Item is in at its current Step, from 1 (e.g. `stepAgeWeeks`); 4 or more shows 4 dots. */
  weeks: number;
  /** The language of the spoken label. */
  locale: Locale;
  className?: string;
};

/**
 * Step Age: one dot per week at the current Step, from 1 up to 4 (4+), grey
 * turning red. An image named "N weeks at this step", so colour is never the
 * only cue. Rabaed shows age only.
 */
export function AgeDots({ weeks, locale, className }: AgeDotsProps) {
  const dots = stepAgeDots(wholeStepAge(weeks));
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
