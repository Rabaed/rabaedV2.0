import { z } from "zod";
import { bilingualText } from "./company.ts";

// Handover (RP-108, ADR 0018; workflow-engine.md §9): before a Member is
// deactivated, removed from a Project, or leaves a Step Pool through a change of
// Position or Visibility, every open Step they hold gets a new holder from its pool.

/** Why the Step was handed over: the change that took its holder out of the pool. */
export const handoverReasons = ["deactivated", "removed", "positions", "visibility"] as const;
export type HandoverReason = (typeof handoverReasons)[number];

/** The Authorized Person's pick for one Step: who holds it from now on. */
export const handoverPick = z.object({ assignmentId: z.uuid(), toMemberId: z.uuid() });
export type HandoverPick = z.infer<typeof handoverPick>;

/** The picks sent with the change; one per Step listed in the `handover_needed` refusal. */
export const handoverPicks = z.array(handoverPick).max(500);

/** A change that may need Handovers: its own body plus the picks. */
export const withHandovers = { handovers: handoverPicks.optional() };

/**
 * One Step the change needs a new holder for (409 `handover_needed`): the item as
 * the Member's own Company sees it, and who may take it, from that Step's pool
 * without them, by English name. One candidate is pre-filled. Never another
 * Company's item or Member (visibility.md scenario RP-108-1).
 */
export const handoverStep = z.object({
  assignmentId: z.uuid(),
  workItemId: z.uuid(),
  project: z.object({ id: z.uuid(), name: bilingualText }),
  /** Null while it has no number yet (a Draft). */
  documentNumber: z.string().nullable(),
  title: z.string(),
  step: bilingualText,
  candidates: z.array(z.object({ id: z.uuid(), fullName: bilingualText })),
});
export type HandoverStep = z.infer<typeof handoverStep>;

/** 409 `handover_needed`'s body. */
export const handoverNeeded = z.object({ error: z.literal("handover_needed"), handovers: z.array(handoverStep) });
export type HandoverNeeded = z.infer<typeof handoverNeeded>;

/** 409 `nobody_can_take`'s body: the first Step with nobody left in its pool, and its Project. */
export const nobodyCanTake = z.object({ error: z.literal("nobody_can_take"), step: bilingualText, project: bilingualText });
export type NobodyCanTake = z.infer<typeof nobodyCanTake>;
