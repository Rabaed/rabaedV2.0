import { z } from "zod";
import { bilingualText, engineerReason } from "./company.ts";
import type { DefinitionIssue, WorkflowDefinition } from "./workflow-definition.ts";
import type { WorkflowProblem } from "./workflow-checks.ts";

// The Workflow authoring commands' requests and answers (RP-427, WF-4; spec RP-423;
// workflow-engine.md §1 "Authoring"). The api serves them to Project Admins (a
// Project's Workflows and bindings) and Authorized Persons (their Company's
// Library); Rabaed Admin to Rabaed Engineers (the Rabaed Defaults, with a reason).

/** Copy a Workflow into Project `projectId`, or into the actor's Company Library when null, named `name`. */
export const duplicateWorkflowRequest = z.object({
  projectId: z.uuid().nullable().default(null),
  name: bilingualText,
});
export type DuplicateWorkflowRequest = z.infer<typeof duplicateWorkflowRequest>;

/**
 * Save a Workflow's draft: the definition document (parsed with
 * `parseWorkflowDefinition`, so its shape is checked there), and optionally a new name.
 */
export const saveWorkflowDraftRequest = z.object({
  name: bilingualText.optional(),
  definition: z.unknown(),
});
export type SaveWorkflowDraftRequest = z.infer<typeof saveWorkflowDraftRequest>;

/** Check a definition, or the saved draft when it is left out, without saving anything. */
export const validateWorkflowRequest = z.object({ definition: z.unknown().optional() });
export type ValidateWorkflowRequest = z.infer<typeof validateWorkflowRequest>;

/** A Rabaed Engineer saves or publishes a Rabaed Default's definition, with the reason Rabaed Admin logs (V9). */
export const rabaedWorkflowRequest = z.object({ definition: z.unknown(), reason: engineerReason });
export type RabaedWorkflowRequest = z.infer<typeof rabaedWorkflowRequest>;

/** What a check finds: where the document doesn't fit the format, else every publish problem. */
export type WorkflowValidation = { issues: DefinitionIssue[]; problems: WorkflowProblem[] };

/** Bind a Project's Work Item Type to a Workflow, for every raiser or, with `raisingParticipantId`, for that one. */
export const bindWorkflowRequest = z.object({
  workItemTypeId: z.uuid(),
  raisingParticipantId: z.uuid().nullable().default(null),
  workflowId: z.uuid(),
});
export type BindWorkflowRequest = z.infer<typeof bindWorkflowRequest>;

/** Take a binding away: the Type's, or one raising Participant's exception. */
export const unbindWorkflowQuery = z.object({
  workItemTypeId: z.uuid(),
  raisingParticipantId: z.uuid().optional(),
});
export type UnbindWorkflowQuery = z.infer<typeof unbindWorkflowQuery>;

/** Who owns a Workflow (ADR 0016). */
export type WorkflowOwnerKind = "rabaed" | "project" | "company";

/**
 * A Workflow as a Member reads it: its published Versions and the latest one's
 * definition (every Member of its Project, V20; its Company for a Library one,
 * V18), and its draft for those who author it only.
 */
export type WorkflowRead = {
  id: string;
  name: { en: string; ar: string };
  owner: WorkflowOwnerKind;
  projectId: string | null;
  workItemTypeId: string | null;
  publishedVersions: number[];
  published: { versionNo: number; definition: WorkflowDefinition } | null;
  /** Null for anyone who doesn't author it, and when it has no draft. */
  draft: { versionNo: number; definition: WorkflowDefinition } | null;
  canAuthor: boolean;
};
