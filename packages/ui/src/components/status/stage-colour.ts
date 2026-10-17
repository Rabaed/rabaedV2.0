import type { stageCategories } from "@rabaed/domain";
import type { StageKey } from "../../tokens/themes.ts";

type Stage = { key: string; category: (typeof stageCategories)[number] };

// The Rabaed Default Stages, by key, to the design system's Stage colours.
const byKey = new Map<string, StageKey>([
  ["draft", "draft"],
  ["internal_review", "internal"],
  ["pending_approval", "pending"],
  ["approved", "approved"],
  ["revise_resubmit", "resubmitted"],
]);

// Any other Stage (e.g. another Module's) takes the colour of its category.
const byCategory: Record<Stage["category"], StageKey> = {
  draft: "draft",
  in_progress: "pending",
  closed_positive: "approved",
  closed_negative: "rejected",
  cancelled: "cancelled",
};

/** The colour category `StagePill` shows a Stage in. */
export function stageColour(stage: Stage): StageKey {
  // A Stage of another Module listed in this tab is `<module>:<key>` (RP-652): coloured as its own key.
  return byKey.get(stage.key.slice(stage.key.indexOf(":") + 1)) ?? byCategory[stage.category];
}
