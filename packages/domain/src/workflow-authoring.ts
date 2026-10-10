import { z } from "zod";
import type { StageCategory } from "./chain-bucket.ts";
import { bilingualText, engineerReason, type BilingualText } from "./company.ts";
import type { BaseRole } from "./project.ts";
import type { DefinitionIssue, WorkflowDefinition } from "./workflow-definition.ts";
import type { WorkflowProblem } from "./workflow-checks.ts";
import type { RuleField } from "./workflow-rules-edit.ts";

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
 * `parseWorkflowDefinition`, so its shape is checked there), and optionally a new name,
 * which the Workflow takes when the draft is published.
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
  /**
   * Null for anyone who doesn't author it, and when it has no draft. `name` is the one
   * the Workflow takes when the draft is published; until then `name` above is its name.
   */
  draft: { versionNo: number; name: { en: string; ar: string }; definition: WorkflowDefinition } | null;
  canAuthor: boolean;
};

/**
 * What the Workflow builder (RP-439, WF-16) edits with, for the Workflow's authors
 * only: the Workflow as they read it (its draft included), its Work Item Type, the
 * Stages of the Type's Module it is checked against (the Project's own, else the
 * Rabaed Defaults'), the Type's outcome set, and the Positions a Step may name.
 */
export type WorkflowBuilderRead = {
  workflow: WorkflowRead;
  type: { code: string; name: BilingualText };
  stages: { key: string; name: BilingualText; category: StageCategory }[];
  outcomes: { code: string; name: BilingualText; closing: boolean; polarity: "positive" | "negative" }[];
  positions: { role: BaseRole; key: string; name: BilingualText }[];
  /**
   * The fields of the Type's latest published Form that take answers (RP-440, WF-17):
   * the only ones a rule's picker lists. Empty before the Type has a published Form.
   */
  fields: RuleField[];
};
