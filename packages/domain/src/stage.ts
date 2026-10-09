import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import { stageCategories } from "./work-item.ts";
import type { WorkflowDefinition } from "./workflow-definition.ts";

// A Project's Stages (RP-428, WF-5; workflow-engine.md "Stages"): per Project and
// Module, seeded from the Rabaed Defaults. Every Project Member reads them; the
// Project Admin renames, adds, reorders and deletes them (a Stage only when no
// Step of the Project's Workflows uses it). A Stage keeps its key and category.

/** A Stage key: snake_case, as Step keys are. */
export const stageKey = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/** A Stage of a Project's Module, as every Project Member reads it, in the Module's order. */
export const projectStage = z.object({
  key: z.string(),
  name: bilingualText,
  category: z.enum(stageCategories),
  /** A Step of one of the Project's Workflow Versions uses it, so it can't be deleted. */
  inUse: z.boolean(),
});
export type ProjectStage = z.infer<typeof projectStage>;

/** A Project's Stages of one Module; `canEdit` for its Project Admins. */
export const projectStages = z.object({ canEdit: z.boolean(), stages: z.array(projectStage) });
export type ProjectStages = z.infer<typeof projectStages>;

export const addStageRequest = z.object({ key: stageKey, name: bilingualText, category: z.enum(stageCategories) });
export type AddStageRequest = z.infer<typeof addStageRequest>;

export const renameStageRequest = z.object({ name: bilingualText });
export type RenameStageRequest = z.infer<typeof renameStageRequest>;

/** Every Stage key of the Module, each once, in the new order. */
export const reorderStagesRequest = z.object({
  keys: z
    .array(stageKey)
    .min(1)
    .max(50)
    .refine((keys) => new Set(keys).size === keys.length, "each Stage once"),
});
export type ReorderStagesRequest = z.infer<typeof reorderStagesRequest>;

/** The refusals of the Stage commands (app.rename_stage, add_stage, reorder_stages, delete_stage). */
export const stageRefusals = ["not_found", "project_closed", "invalid_name", "invalid_stage", "stage_exists", "invalid_order", "stage_in_use"] as const;

/** A Stage the Workflow uses that the Project's Module doesn't have, with a Step in it. */
export type StageCopyProblem = { code: "stage_missing"; stage: string; step: string; message: BilingualText };

/**
 * Copying a Workflow into a Project maps its Stages by key: refused, with one
 * problem per Stage the Project's Module lacks, naming the first Step in it.
 */
export function stageCopyProblems(definition: Pick<WorkflowDefinition, "steps">, stages: readonly { key: string }[]): StageCopyProblem[] {
  const have = new Set(stages.map((s) => s.key));
  const missing = new Map<string, WorkflowDefinition["steps"][number]>();
  for (const step of definition.steps) if (!have.has(step.stage) && !missing.has(step.stage)) missing.set(step.stage, step);
  return [...missing].map(([stage, step]) => ({
    code: "stage_missing",
    stage,
    step: step.key,
    message: {
      en: `This Project has no Stage "${stage}" (used by ${step.name.en}). Add it in the Project's Stages first.`,
      ar: `لا توجد في هذا المشروع مرحلة "${stage}" (تستخدمها الخطوة ${step.name.ar}). أضفها أولاً في مراحل المشروع.`,
    },
  }));
}
