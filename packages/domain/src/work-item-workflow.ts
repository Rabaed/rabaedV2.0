import { z } from "zod";
import { bilingualText } from "./company.ts";
import { baseRoles, type BaseRole } from "./project.ts";
import { stageCategories } from "./work-item.ts";
import { workflowDefinition, type WorkflowDefinition } from "./workflow-definition.ts";

// The map of a Work Item's Workflow (RP-438, WF-15; workflow-engine.md §11): the
// Version the item is pinned to, whole, as every Project Member reads it (V20), and
// where the item is on it as the viewer may know (V14). Inside the viewer's own
// Participant that is its current Step; with another Participant it is only which
// Participant role holds it and that Company's name: never its internal Step, and
// none of the Returns taken there.

/**
 * Where the item is, as the viewer may know it: `own`, at a Step of their own
 * Participant; `company`, with another Participant, by its role and Company name;
 * `closed`, at the terminal Step its outcome reached (null when the outcome
 * reaches more than one).
 */
export const workItemMapPosition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("own"), stepKey: z.string() }),
  z.object({ kind: z.literal("company"), role: z.enum(baseRoles), companyName: bilingualText }),
  z.object({ kind: z.literal("closed"), stepKey: z.string().nullable() }),
]);
export type WorkItemMapPosition = z.infer<typeof workItemMapPosition>;

/** A Work Item's Workflow map: `GET /v1/work-items/:id/workflow`. */
export const workItemWorkflowMap = z.object({
  name: bilingualText,
  /** The Version the item is pinned to, for good (ADR 0016). */
  versionNo: z.number().int().positive(),
  /** The Workflow's latest published Version: the drawer says when it is newer. */
  latestVersionNo: z.number().int().positive(),
  definition: workflowDefinition,
  /** The Stages of the item's Project and Module, in their order: the canvas's bands. */
  stages: z.array(z.object({ key: z.string(), name: bilingualText, category: z.enum(stageCategories) })),
  /** The names of the Positions the definition's Steps are narrowed to, by role and key. */
  positions: z.array(z.object({ role: z.enum(baseRoles), key: z.string(), name: bilingualText })),
  /** The viewer's own Participant's role on the Project: its Steps are shown one by one. Null for a reader who has none. */
  viewerRole: z.enum(baseRoles).nullable(),
  /** Null while an open item has no holder the viewer may know of. */
  position: workItemMapPosition.nullable(),
});
export type WorkItemWorkflowMap = z.infer<typeof workItemWorkflowMap>;

/** The terminal Step a closed item with `outcome` reached: the one every close (or Cancel) setting it leads to; null if several or none. */
export function closedStepKey(definition: WorkflowDefinition, outcome: string): string | null {
  const reached = new Set(
    definition.transitions
      .filter((t) => (outcome === "cancelled" ? t.kind === "cancel" : t.kind === "close" && t.outcome === outcome))
      .map((t) => t.to),
  );
  return reached.size === 1 ? [...reached][0]! : null;
}

/** The Participant role holding Step `stepKey`; null for a terminal Step or a key the definition doesn't have. */
export function holderRole(definition: WorkflowDefinition, stepKey: string): BaseRole | null {
  return definition.steps.find((s) => s.key === stepKey)?.actor?.role ?? null;
}
