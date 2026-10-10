import { z } from "zod";
import { bilingualText } from "./company.ts";

// Handover (RP-108, ADR 0018; workflow-engine.md §9): before a Member is
// deactivated, removed from a Project, or leaves a Step Pool through a change of
// Position or Visibility (theirs, or their whole Participant's), every open Step they
// hold gets a new holder from its pool.

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

const person = z.object({ id: z.uuid(), fullName: bilingualText });

/**
 * One Step the change needs a new holder for (409 `handover_needed`): its Project and
 * Step, the item as the one making the change sees it, who holds it, and who may take
 * it, from that Step's pool without them (the dialog orders them in the viewer's
 * language; one candidate is pre-filled). Never another Company's item or Member
 * (visibility.md scenario RP-108-1).
 */
export const handoverStep = z.object({
  /** What the pick names. */
  assignmentId: z.uuid(),
  project: z.object({ id: z.uuid(), name: bilingualText }),
  step: bilingualText,
  /**
   * Null for an item they don't see (not on the Project, or narrower Visibility): it
   * reads "An item at <Step> on <Project>" (scenario RP-108-2).
   */
  item: z
    .object({
      id: z.uuid(),
      /** Null while it has no number yet (a Draft). */
      documentNumber: z.string().nullable(),
      title: z.string(),
    })
    .nullable(),
  /** Who holds it now: the Member the change takes out of its pool. */
  holder: person,
  candidates: z.array(person),
});
export type HandoverStep = z.infer<typeof handoverStep>;

/** 409 `handover_needed`'s body. */
export const handoverNeeded = z.object({ error: z.literal("handover_needed"), handovers: z.array(handoverStep) });
export type HandoverNeeded = z.infer<typeof handoverNeeded>;

/** 409 `nobody_can_take`'s body: the first Step with nobody left in its pool, and its Project. */
export const nobodyCanTake = z.object({ error: z.literal("nobody_can_take"), step: bilingualText, project: bilingualText });
export type NobodyCanTake = z.infer<typeof nobodyCanTake>;

/**
 * 409 `other_company_handover`'s body: a Project Admin narrowing another Company's
 * Participant would take its Members off `steps` Steps; that Company hands them over
 * first. Only how many and whose, never a Step, item or Member (V14; scenario RP-108-3).
 */
export const otherCompanyHandover = z.object({ error: z.literal("other_company_handover"), steps: z.number().int().positive(), company: bilingualText });
export type OtherCompanyHandover = z.infer<typeof otherCompanyHandover>;
