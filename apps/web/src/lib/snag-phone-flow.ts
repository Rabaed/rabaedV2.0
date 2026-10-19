import type { DimensionValues, WorkItemDetail } from "@rabaed/domain";

// The camera-first New Snag on a phone (RP-630; kit `snag/mobile.js`): the photos, then the
// Subject (with the Description and Trade: the Draft is created here, since its Subject is fixed
// once it exists, and the photos are uploaded to it), then the Location (saved to the Draft as soon
// as it is picked), then Raise. The kit's "Pin on plan" waits for Pins; the Contractor pick waits
// for the engine to offer one (RP-658): until then a Raise two Contractors cover is not offered.
// The page's URL holds the Draft and the step, so a reload reopens the same step.

export const phoneSteps = ["photo", "subject", "location", "raise"] as const;
export type PhoneStep = (typeof phoneSteps)[number];

type Draft = Pick<WorkItemDetail, "answers"> & { stage: Pick<WorkItemDetail["stage"], "category"> };

/**
 * The step the flow opens at. Without a Draft, the camera: the photos taken before the Subject step
 * live only in the page. With one, the step asked for, from the Location on (its Subject can't
 * change), but never Raise before a Location is picked. "done" once it has left Draft.
 */
export function phoneFlowStep({ draft, step }: { draft: Draft | null; step?: string }): PhoneStep | "done" {
  if (draft === null) return "photo";
  if (draft.stage.category !== "draft") return "done";
  const located = typeof draft.answers.location === "string";
  if (step === "location") return "location";
  return located ? "raise" : "location";
}

type Location = DimensionValues["location"][number];

/** The places to pick from inside `parentId` (the Zones at the top), in the order the Project lists them. */
export function locationChoices(locations: readonly Location[], parentId: string | null): Location[] {
  return locations.filter((l) => l.parentId === parentId);
}

/** The path from the Zone down to `id`, outermost first; empty when it is not among `locations`. */
export function locationPath(locations: readonly Location[], id: string | undefined): Location[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: Location[] = [];
  for (let at = id ? byId.get(id) : undefined; at; at = at.parentId ? byId.get(at.parentId) : undefined) path.unshift(at);
  return path;
}

/** The Draft's answers to save at the Location step: as read, with the Location picked. */
export function withLocation(answers: Readonly<Record<string, unknown>>, location: string): Record<string, unknown> {
  return { ...answers, location };
}
