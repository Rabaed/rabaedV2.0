import { z } from "zod";
import { bilingualText } from "./company.ts";

// The Snag List's bulk actions (RP-629, spec RP-619): reassign within my company and move Stage,
// on the rows chosen in the List. Each acts item by item as the single-item command does, so an
// item the viewer may not act on is skipped and named, never refused as a whole: the answer says
// which were done and which were not, and why. Only items the viewer sees are ever named (V3).

/** The most items one bulk action takes: a List page is at most 100 rows. */
export const snagBulkMax = 100;

const items = z.array(z.uuid()).min(1).max(snagBulkMax);

/** Move the chosen items to a Stage, each by the Transition that leads there, if the viewer may take it. */
export const snagBulkMoveRequest = z.object({
  ids: items,
  /** The Stage's key. */
  stage: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** One per request; each item's own key is made from it, so a retry applies once. */
  idempotencyKey: z.uuid(),
});
export type SnagBulkMoveRequest = z.infer<typeof snagBulkMoveRequest>;

/** Which of the chosen items the viewer could hand to a Member of their own Participant, and to whom. */
export const snagBulkCandidatesRequest = z.object({ ids: items });
export type SnagBulkCandidatesRequest = z.infer<typeof snagBulkCandidatesRequest>;

export const snagBulkCandidates = z.object({
  /** How many of the chosen items the viewer's Participant holds and the viewer may reassign. */
  reassignable: z.number().int().nonnegative(),
  /** The viewer's own Participant's Members who could take at least one of them, each with how many. */
  members: z.array(z.object({ memberId: z.uuid(), name: bilingualText, items: z.number().int().positive() })),
});
export type SnagBulkCandidates = z.infer<typeof snagBulkCandidates>;

/** Hand the chosen items to one Member of the viewer's own Participant. */
export const snagBulkReassignRequest = z.object({ ids: items, toMemberId: z.uuid() });
export type SnagBulkReassignRequest = z.infer<typeof snagBulkReassignRequest>;

/**
 * Why an item was left as it was:
 * - `not_found`: not an item the viewer sees (named by nothing but this);
 * - `not_offered`: the viewer's Participant doesn't hold it, they may not act on it, or the move or the
 *   Member isn't offered to them for it;
 * - `needs_input`: the Transition that leads there asks for something (a note, a Code), so it is taken one by one;
 * - `already_there`: it is at that Stage already;
 * - `refused`: the Transition was offered but its rules refused it now.
 */
export const snagBulkSkipReasons = ["not_found", "not_offered", "needs_input", "already_there", "refused"] as const;
export type SnagBulkSkipReason = (typeof snagBulkSkipReasons)[number];

export const snagBulkResult = z.object({
  /** The items that were moved or reassigned. */
  done: z.array(z.uuid()),
  /** The others, each with its Document Number and Subject when the viewer sees it. */
  skipped: z.array(
    z.object({
      id: z.uuid(),
      documentNumber: z.string().nullable(),
      title: z.string().nullable(),
      reason: z.enum(snagBulkSkipReasons),
    }),
  ),
});
export type SnagBulkResult = z.infer<typeof snagBulkResult>;
