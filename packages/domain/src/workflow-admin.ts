import { z } from "zod";
import { bilingualText, engineerReason } from "./company.ts";
import { moduleKeySchema } from "./module.ts";
import { outcomeActions, outcomeCode, outcomePolarities, type Outcome } from "./outcome.ts";
import { addStageRequest, stageKey } from "./stage.ts";
import type { WorkflowBuilderRead } from "./workflow-authoring.ts";

// Rabaed Admin -> Workflows (RP-443, WF-20; workflow-engine.md section 1 "Authoring"): a
// Rabaed Engineer authors the Rabaed Defaults of each Work Item Type with the builder, and
// edits the Rabaed Default outcome sets and Stage sets. Every action carries the reason
// Rabaed Admin logs (visibility.md V9).

/** One Rabaed Default Work Item Type and its Workflow, in the list. */
export const adminWorkflowSummary = z.object({
  code: z.string(),
  name: bilingualText,
  moduleKey: moduleKeySchema,
  publishedVersions: z.array(z.number().int()),
  hasDraft: z.boolean(),
});
export type AdminWorkflowSummary = z.infer<typeof adminWorkflowSummary>;

/** What the admin builder page edits with: the builder's read, plus the Rabaed Default outcome set in full. */
export type AdminWorkflowRead = WorkflowBuilderRead & { moduleKey: z.infer<typeof moduleKeySchema>; outcomeSet: Outcome[] };

/** Copies another Rabaed Default's Workflow (its draft, else its latest Version) in as this Type's draft. */
export const adminDuplicateWorkflowRequest = z.object({ fromTypeCode: z.string().trim().min(1).max(32), reason: engineerReason });
export type AdminDuplicateWorkflowRequest = z.infer<typeof adminDuplicateWorkflowRequest>;

/** A new outcome of a Rabaed Default set. */
export const adminAddOutcomeRequest = z
  .object({ code: outcomeCode, name: bilingualText, closing: z.boolean(), polarity: z.enum(outcomePolarities), actions: outcomeActions, reason: engineerReason })
  .strict();
/** An outcome's names and follow-up actions: its code, closing and polarity stay (Projects rely on them). */
export const adminChangeOutcomeRequest = z.object({ name: bilingualText, actions: outcomeActions, reason: engineerReason }).strict();
export const adminReorderOutcomesRequest = z
  .object({
    codes: z
      .array(outcomeCode)
      .min(1)
      .max(50)
      .refine((codes) => new Set(codes).size === codes.length, "each outcome once"),
    reason: engineerReason,
  })
  .strict();

export const adminAddStageRequest = addStageRequest.extend({ reason: engineerReason }).strict();
export const adminRenameStageRequest = z.object({ name: bilingualText, reason: engineerReason }).strict();
export const adminReorderStagesRequest = z
  .object({
    keys: z
      .array(stageKey)
      .min(1)
      .max(50)
      .refine((keys) => new Set(keys).size === keys.length, "each Stage once"),
    reason: engineerReason,
  })
  .strict();
