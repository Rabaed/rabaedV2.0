import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import type { OutcomeKind } from "./chain-bucket.ts";
import { condition } from "./condition.ts";
import { baseRoles } from "./project.ts";
import { transitionKinds, type TransitionKind } from "./work-item.ts";

// The Workflow definition format (workflow-engine.md §1, §11; RP-425, spec RP-423;
// ADR 0016, ADR 0017). One JSON document per Workflow Version: its Steps, its
// Transitions and the builder's layout. The builder (live), the api (publish) and
// Rabaed Admin all read it through `parseWorkflowDefinition`, and the publish
// checks (`workflowPublishProblems`, workflow-checks.ts) run over it. A Version is
// stored as rows (workflow_step, workflow_transition, workflow_version.layout);
// `definitionFromRows` and `definitionToRows` convert both ways without loss.

/** A Step, Transition, Stage, Position or Form field key (snake_case, as Form keys are). */
const key = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

/** The Function Permissions a Position bundles (GLOSSARY "Position"); a Step or Transition needs one. */
export const functionPermissions = ["view", "create", "submit", "review", "approve", "assign", "close", "attach"] as const;
export type FunctionPermission = (typeof functionPermissions)[number];

/**
 * What a Step does about the outcome: nothing, Recommend a Code (inside its
 * Participant, §5.3), or issue the outcome (the Issued Code or the Inspection
 * Result, by the Work Item Type's outcome kind).
 */
export const outcomeModes = ["none", "recommend_code", "issue_outcome"] as const;
export type OutcomeMode = (typeof outcomeModes)[number];

/**
 * Who may hold a Step: a Participant role, the Function Permission its Step Pool
 * holds, and optionally the Positions it is narrowed to. `member` names one
 * person; a Library or Project Workflow names none (publish check `names_person`).
 */
const actorRule = z.strictObject({
  role: z.enum(baseRoles),
  permission: z.enum(functionPermissions),
  positions: z.array(key).min(1).optional(),
  member: z.uuid().optional(),
});
export type ActorRule = z.infer<typeof actorRule>;

const step = z.strictObject({
  key,
  name: bilingualText,
  /** The Stage key: the Kanban column. */
  stage: key,
  /** Null on a terminal Step: nobody holds a closed item. */
  actor: actorRule.nullable(),
  outcomeMode: z.enum(outcomeModes),
});
export type WorkflowStep = z.infer<typeof step>;

/**
 * Restrict (Jira's "conditions"): the Transition is offered only when each holds.
 * `condition` reads the item's Form answers and attributes (§4); among
 * Transitions sharing a label and source Step it picks the one that matches.
 */
const restriction = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("condition"), condition }),
  z.strictObject({ type: z.literal("positions"), positions: z.array(key).min(1) }),
  /** Separation of duties: not the Member who took the item out of this Step. */
  z.strictObject({ type: z.literal("not_same_person"), step: key }),
  /** The item has been through this Step (one of the acting Participant's own). */
  z.strictObject({ type: z.literal("been_through"), step: key }),
  z.strictObject({ type: z.literal("all_closed"), items: z.enum(["comments", "subtasks"]) }),
]);
export type Restriction = z.infer<typeof restriction>;

/** Validate: the Transition is offered, and taking it is refused with the message unless each holds. */
const validation = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("condition"), condition, message: bilingualText }),
  z.strictObject({ type: z.literal("form_complete") }),
  z.strictObject({ type: z.literal("has_document") }),
]);
export type Validation = z.infer<typeof validation>;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** What taking the Transition does besides moving the item. */
const transitionAction = z.discriminatedUnion("type", [
  /** Offer "Assign to" among the acting Participant's own Members. */
  z.strictObject({ type: z.literal("offer_assign_to") }),
  /** Assign the next Step to one named Member. */
  z.strictObject({ type: z.literal("assign_to"), member: z.uuid() }),
  z.strictObject({ type: z.literal("set_field"), field: key, value: scalar }),
  z.strictObject({ type: z.literal("copy_field"), from: key, to: key }),
]);
export type TransitionAction = z.infer<typeof transitionAction>;

/** Whom the Transition notifies (in-app always; email by each Member's settings). */
const recipient = z.discriminatedUnion("to", [
  z.strictObject({ to: z.literal("holder") }),
  z.strictObject({ to: z.literal("raiser") }),
  z.strictObject({ to: z.literal("watchers") }),
  z.strictObject({ to: z.literal("position"), position: key }),
  z.strictObject({ to: z.literal("member"), member: z.uuid() }),
]);
export type NotificationRecipient = z.infer<typeof recipient>;

const transition = z.strictObject({
  key,
  label: bilingualText,
  kind: z.enum(transitionKinds),
  from: key,
  to: key,
  /** The outcome code it sets; checked against the Work Item Type's outcome set at publish (check 3). */
  outcome: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(32).nullable(),
  permission: z.enum(functionPermissions),
  /** The Action Form's Form schema as stored, checked at publish (check 7); null: the Internal Note only. */
  actionForm: z.record(z.string(), z.unknown()).nullable(),
  rules: z.strictObject({ restrict: z.array(restriction).optional(), validate: z.array(validation).optional() }).optional(),
  actions: z.array(transitionAction).optional(),
  notifications: z.array(recipient).optional(),
});
export type WorkflowTransition = z.infer<typeof transition>;

export const workflowDefinition = z.strictObject({
  steps: z.array(step),
  transitions: z.array(transition),
  /** Node positions for the builder, by Step key. */
  layout: z.record(key, z.strictObject({ x: z.number(), y: z.number() })),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinition>;

/** Where a definition doesn't fit the format: the path (dot-separated, "" for the top) and what is wrong. */
export type DefinitionIssue = { path: string; message: string };

/** Reads a definition from JSON (the builder's, an imported file's); refuses unknown keys at any depth. */
export function parseWorkflowDefinition(input: unknown): { ok: true; definition: WorkflowDefinition } | { ok: false; issues: DefinitionIssue[] } {
  const parsed = workflowDefinition.safeParse(input);
  if (parsed.success) return { ok: true, definition: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

// Rows -----------------------------------------------------------------------------

/** A `workflow_step` row of a Version. */
export type WorkflowStepRow = {
  key: string;
  name: BilingualText;
  stage_key: string;
  /** `{ base_role, permission, positions?, member? }`; `{}` on a terminal Step. */
  actor_rule: Record<string, unknown>;
  /** Dropped by ADR 0017 (every Transition is confirmed and recorded): always written false. */
  is_signing: boolean;
  outcome_mode: "none" | "recommend_code" | "issue_code" | "inspection_result";
};

/**
 * A `workflow_transition` row of a Version, its Steps by key. `rules`, `actions`
 * and `notifications` have no columns yet (WF-7, WF-8, WF-9 add them): they are
 * present only when the definition has them.
 */
export type WorkflowTransitionRow = {
  key: string;
  from_step_key: string;
  to_step_key: string;
  label: BilingualText;
  kind: TransitionKind;
  outcome: string | null;
  permission: string;
  sort: number;
  action_form: unknown;
  rules?: unknown;
  actions?: unknown;
  notifications?: unknown;
};

/** A Workflow Version as rows: its layout, Steps and Transitions (in `sort` order). */
export type WorkflowVersionRows = { layout: unknown; steps: WorkflowStepRow[]; transitions: WorkflowTransitionRow[] };

/** A Version's rows as a definition. Throws when they don't fit the format (a published Version always does). */
export function definitionFromRows(rows: WorkflowVersionRows): WorkflowDefinition {
  return workflowDefinition.parse({
    steps: rows.steps.map((s) => ({
      key: s.key,
      name: s.name,
      stage: s.stage_key,
      actor: Object.keys(s.actor_rule).length === 0 ? null : actorFromRule(s.actor_rule),
      outcomeMode: s.outcome_mode === "issue_code" || s.outcome_mode === "inspection_result" ? "issue_outcome" : s.outcome_mode,
    })),
    transitions: [...rows.transitions]
      .sort((a, b) => a.sort - b.sort)
      .map((t) => ({
        key: t.key,
        label: t.label,
        kind: t.kind,
        from: t.from_step_key,
        to: t.to_step_key,
        outcome: t.outcome,
        permission: t.permission,
        actionForm: t.action_form ?? null,
        ...(t.rules === undefined ? {} : { rules: t.rules }),
        ...(t.actions === undefined ? {} : { actions: t.actions }),
        ...(t.notifications === undefined ? {} : { notifications: t.notifications }),
      })),
    layout: rows.layout,
  });
}

const actorFromRule = ({ base_role, ...rest }: Record<string, unknown>) => ({ role: base_role, ...rest });

/**
 * A definition as a Version's rows, for a Work Item Type of `outcomeKind`: an
 * issuing Step issues its Inspection Result for a Type with Inspection Results,
 * else its Review Code. Transitions are sorted as listed, from 1.
 */
export function definitionToRows(definition: WorkflowDefinition, outcomeKind: OutcomeKind): WorkflowVersionRows {
  return {
    layout: definition.layout,
    steps: definition.steps.map((s) => ({
      key: s.key,
      name: s.name,
      stage_key: s.stage,
      actor_rule: s.actor === null ? {} : (({ role, ...rest }) => ({ base_role: role, ...rest }))(s.actor),
      is_signing: false,
      outcome_mode: s.outcomeMode === "issue_outcome" ? (outcomeKind === "inspection_result" ? "inspection_result" : "issue_code") : s.outcomeMode,
    })),
    transitions: definition.transitions.map((t, index) => ({
      key: t.key,
      from_step_key: t.from,
      to_step_key: t.to,
      label: t.label,
      kind: t.kind,
      outcome: t.outcome,
      permission: t.permission,
      sort: index + 1,
      action_form: t.actionForm,
      ...(t.rules === undefined ? {} : { rules: t.rules }),
      ...(t.actions === undefined ? {} : { actions: t.actions }),
      ...(t.notifications === undefined ? {} : { notifications: t.notifications }),
    })),
  };
}
