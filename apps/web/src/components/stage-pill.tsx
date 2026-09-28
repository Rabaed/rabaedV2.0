import type { BilingualText, Locale } from "@rabaed/domain";

// Stage keys of the Rabaed Default Stages, to the design system's Stage colours.
// Full class names, so Tailwind finds them.
const colours: Record<string, string> = {
  draft: "bg-stage-draft-bg text-stage-draft-fg",
  internal_review: "bg-stage-internal-bg text-stage-internal-fg",
  pending_approval: "bg-stage-pending-bg text-stage-pending-fg",
  approved: "bg-stage-approved-bg text-stage-approved-fg",
  revise_resubmit: "bg-stage-resubmitted-bg text-stage-resubmitted-fg",
};
const fallback = "bg-stage-cancelled-bg text-stage-cancelled-fg";

/** A Work Item's Stage, as a coloured pill. */
export function StagePill({ stage, locale }: { stage: { key: string; name: BilingualText }; locale: Locale }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[stage.key] ?? fallback}`}>
      {stage.name[locale]}
    </span>
  );
}
