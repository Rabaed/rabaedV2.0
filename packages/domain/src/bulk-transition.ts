import { z } from "zod";
import { bilingualText } from "./company.ts";
import { fieldError } from "./form.ts";
import { packageItem } from "./package.ts";
import { takeTransitionRequest } from "./work-item.ts";

/**
 * A bulk Transition (spec RP-616 stories 39–45; RP-646): one Transition taken on
 * several items at once, with one set of Action Form answers, one Internal Note and,
 * when the Transition offers "Assign to", one Member picked for all. Confirmed once
 * in its pop-up (ADR 0017); the key makes a repeated request apply only once,
 * answering with the same items. Not tied to Packages: any list of items.
 */
export const bulkTransitionRequest = takeTransitionRequest.omit({ recommendedCode: true }).extend({
  /** The items, each one the Member sees; the same id twice counts once. */
  workItemIds: z.array(z.uuid()).min(1).max(200),
});
export type BulkTransitionRequest = z.input<typeof bulkTransitionRequest>;

/** A bulk Transition taken: the items it moved, as the Member reads them now. */
export const bulkTransitionTaken = z.object({ taken: z.array(packageItem) });
export type BulkTransitionTaken = z.infer<typeof bulkTransitionTaken>;

/**
 * Why an item stops a bulk Transition, so nothing is taken: it doesn't wait on the
 * Member (`not_waiting`: not theirs to act on, or closed), it doesn't offer them the
 * Transition (`transition_not_offered`: another Step, or still to pick up), it offers
 * it with another Action Form than the first item's (`different_action_form`: another
 * Screen Version), or its own Transition refuses it as a single one would: its Form
 * incomplete, the Action Form's answers, a Validate rule, the "Assign to" pick, or
 * another refusal of the engine (`refused`).
 */
export const bulkStopReasons = [
  "not_waiting",
  "transition_not_offered",
  "different_action_form",
  "form_incomplete",
  "invalid_action_form",
  "validation_failed",
  "assignee_not_offered",
  "refused",
] as const;
export const bulkStopReason = z.enum(bulkStopReasons);
export type BulkStopReason = z.infer<typeof bulkStopReason>;

/** The item that stopped a bulk Transition, and why; with the per-field errors or the Validate rule's message where its own Transition gave them. */
export const bulkStop = packageItem.extend({
  reason: bulkStopReason,
  errors: z.array(fieldError).optional(),
  message: bilingualText.optional(),
});
export type BulkStop = z.infer<typeof bulkStop>;
