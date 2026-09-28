import { stepAgeDots } from "@rabaed/domain";

// One colour per filled dot count, grey to red; full class names, so Tailwind finds them.
const filled = ["", "bg-age-1", "bg-age-2", "bg-age-3", "bg-age-4"];

/**
 * Step Age: one dot per week at the current Step, up to 4, going from grey to
 * red. Age only: Rabaed sets no due dates. `label` is the spoken text, e.g.
 * "2 weeks at this step".
 */
export function AgeDots({ weeks, label }: { weeks: number; label: string }) {
  const dots = stepAgeDots(weeks);
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center gap-1">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={`size-2 rounded-full ${i <= dots ? filled[dots] : "bg-age-0"}`} />
      ))}
    </span>
  );
}
