import { z } from "zod";
import type { StageCategory } from "./chain-bucket.ts";
import { bilingualText, engineerReason, type BilingualText } from "./company.ts";
import type { DefinitionIssue, WorkflowDefinition } from "./workflow-definition.ts";
import type { WorkflowProblem } from "./workflow-checks.ts";
import type { FormSchema } from "./form.ts";
import type { PositionOption } from "./workflow-rules-edit.ts";

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
export const rabaedWorkflowRequest = z.object({
  definition: z.unknown(),
  reason: engineerReason,
  /** On a publish: the change note the Version keeps (RP-555). */
  changeNote: z.string().trim().min(1).max(1000).optional(),
});
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
  outcomes: WorkflowOutcomeOption[];
  positions: PositionOption[];
  /**
   * The Type's latest published Form (RP-440, WF-17), which publish check 6 reads: a
   * rule's pickers list only its fields, by group (transitionRuleFields). Null before
   * the Type has a published Form.
   */
  form: FormSchema | null;
  /**
   * The Screens a Transition may show (ADR 0019, RP-555's picker): for each key, the
   * owner's Screen with that key, else the Rabaed Default one, at its latest published
   * Version, as publishing would pin it (app.workflow_screens).
   */
  screens: WorkflowScreenOption[];
  /**
   * How many items still run on each published Version, counting only the items the
   * author sees (RP-555; scenario RP-555-1): the publish dialog says they keep their
   * Version. Versions no visible item runs on are left out.
   */
  running: { versionNo: number; count: number }[];
};

/** A Screen the builder offers a Transition, by key, with what it asks. */
export type WorkflowScreenOption = { key: string; name: BilingualText; schema: FormSchema };

/**
 * Publish a Workflow's draft, with the change note its Versions history shows (RP-555): the
 * builder's publish dialog always gives one. A publish with no body keeps no Change Note (a copy
 * published as it is, from Settings → Workflows).
 */
export const publishWorkflowRequest = z.object({ changeNote: z.string().trim().min(1).max(1000).optional() }).optional();
export type PublishWorkflowRequest = z.infer<typeof publishWorkflowRequest>;

// The Library's Workflows (RP-442, WF-19; ADR 0016; visibility.md V18). A Company keeps
// copies of Workflows in its Library, private to it until one is copied into a Project.

/** Save a Workflow the Member reads, whatever its owner, to their Company's Library under `name` (their Authorized Person only). */
export const saveWorkflowToLibraryRequest = z.object({ name: bilingualText });
export type SaveWorkflowToLibraryRequest = z.infer<typeof saveWorkflowToLibraryRequest>;

/**
 * The copy saved to the Library. It is published at once, as the Version of the
 * Workflow it was copied from; when the Library's checks refuse that (the original uses
 * a Stage only its Project has), the copy stays a draft in the Library, `published` is
 * false and `problems` say why, so its Authorized Person finishes it in the builder.
 */
export type SavedToLibrary = { id: string; published: boolean; problems: WorkflowProblem[] };

/** One of the Company's Library Workflows, as its Members list it. */
export type LibraryWorkflow = {
  id: string;
  name: BilingualText;
  workItemType: { id: string; code: string; name: BilingualText } | null;
  /** The numbers of its published Versions, in order; none while it is only a draft, which only its Authorized Person lists. */
  publishedVersions: number[];
  /** When its latest Version was published, else when it was copied in. */
  updatedAt: string;
  /** The Company's default Workflow for its Type (Company defaults, RP-517). */
  isDefault: boolean;
};

/** The Company's Library Workflows: private to the Company, so only its own Members read them (V18). */
export type LibraryWorkflows = { workflows: LibraryWorkflow[] };

/**
 * A Workflow to look at, for whoever reads it (V18, V20): the same map the builder opens
 * on, without what only authors need (the Form and the outcome set).
 */
export type WorkflowMapRead = Pick<WorkflowBuilderRead, "workflow" | "type" | "stages" | "positions">;

/** An outcome of a Work Item Type's set, as the builder offers it to a closing Transition. */
export type WorkflowOutcomeOption = { code: string; name: BilingualText; closing: boolean; polarity: "positive" | "negative" };
