import { z } from "zod";
import { bilingualText, type BilingualText } from "./company.ts";
import type { OutcomeKind } from "./outcome.ts";
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
//
// No Workflow names a person: a Rabaed Default is copied into Projects of other
// Companies, and a Project or Library Workflow is read project-wide (ADR 0016). The
// format has Positions only, so it has no way to hold a Member.

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
 * holds, and optionally the Positions it is narrowed to.
 */
const actorRule = z.strictObject({
  role: z.enum(baseRoles),
  permission: z.enum(functionPermissions),
  positions: z.array(key).min(1).optional(),
});
export type ActorRule = z.infer<typeof actorRule>;

/** Who of the raiser's Company reads a Draft: all its Members who see the item, or only the Member holding it (ADR 0019). */
export const draftsVisibleTo = ["company", "author"] as const;
export type DraftsVisibleTo = (typeof draftsVisibleTo)[number];

const step = z.strictObject({
  key,
  name: bilingualText,
  /** The Stage key: the Kanban column. */
  stage: key,
  /** Null on a terminal Step: nobody holds a closed item. */
  actor: actorRule.nullable(),
  outcomeMode: z.enum(outcomeModes),
  /**
   * Whether the raiser's Form is edited here, by the Member holding the Step (ADR 0019,
   * RP-514). Left out: the default (`stepEditsForm`, workflow-checks.ts).
   */
  editsForm: z.boolean().optional(),
  /** On the Draft Step: who of the raiser's Company reads a Draft (V1). Left out: `company`. */
  draftsVisibleTo: z.enum(draftsVisibleTo).optional(),
});
export type WorkflowStep = z.infer<typeof step>;

/** What every Participant may know of an item's route (WF-7): it was Sent Back, or it is a Revision. */
export const sharedRouteFacts = ["sent_back", "revision"] as const;

/**
 * Restrict (Jira's "conditions"): the Transition is offered only when each holds.
 * `condition` reads the item's Form answers and attributes, and the Action Form
 * answers when it picks among Transitions sharing a label and source Step (§4).
 */
const restriction = z.union([
  z.strictObject({ type: z.literal("condition"), condition }),
  z.strictObject({ type: z.literal("positions"), positions: z.array(key).min(1) }),
  /** Separation of duties: not the Member who held this Step… */
  z.strictObject({ type: z.literal("not_same_person"), step: key }),
  /** …or who took this Transition. */
  z.strictObject({ type: z.literal("not_same_person"), transition: key }),
  /** The item has been through this Step (one of the acting Participant's own)… */
  z.strictObject({ type: z.literal("been_through"), step: key }),
  /** …or a fact every Participant knows. */
  z.strictObject({ type: z.literal("been_through"), fact: z.enum(sharedRouteFacts) }),
  z.strictObject({ type: z.literal("all_closed"), items: z.enum(["comments", "subtasks"]) }),
]);
export type Restriction = z.infer<typeof restriction>;

/** Validate: the Transition is offered, and taking it is refused with the message unless each holds. */
const validation = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("condition"), condition, message: bilingualText }),
  z.strictObject({ type: z.literal("form_complete") }),
  /** At least one Document: on the item, or in the named Document field. */
  z.strictObject({ type: z.literal("has_document"), field: key.optional() }),
]);
export type Validation = z.infer<typeof validation>;

/** A Transition's rules, as stored in `workflow_transition.rules` (WF-7). */
export const transitionRules = z.strictObject({ restrict: z.array(restriction).optional(), validate: z.array(validation).optional() });
export type TransitionRules = z.infer<typeof transitionRules>;

/**
 * A Transition's rules as `workflow_transition.rules` stores them (null: none). They fit
 * the format when they were published: rules that no longer do throw, never read as no
 * rules (a skipped Validate would let the move through).
 */
export function storedTransitionRules(stored: unknown): TransitionRules {
  return stored == null ? {} : transitionRules.parse(stored);
}

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** The moment the Transition is taken, as a set field's value (not the text "now"). */
const setToNow =z.strictObject({ now: z.literal(true) });

/** What taking the Transition does besides moving the item. */
const transitionAction = z.discriminatedUnion("type", [
  /**
   * Offer "Assign to" (WF-8): the actor picks the next holder among their own
   * Participant's Members who may hold the next Step (its Step Pool), so only when
   * that Participant holds it; nothing is stored here.
   */
  z.strictObject({ type: z.literal("offer_assign_to") }),
  z.strictObject({ type: z.literal("set_field"), field: key, value: z.union([scalar, setToNow]) }),
  z.strictObject({ type: z.literal("copy_field"), from: key, to: key }),
]);
export type TransitionAction = z.infer<typeof transitionAction>;

/** Whom the Transition notifies besides the next holder or Step Pool (in-app always; email by each Member's settings). */
const recipient = z.discriminatedUnion("to", [
  z.strictObject({ to: z.literal("holder") }),
  z.strictObject({ to: z.literal("raiser") }),
  z.strictObject({ to: z.literal("watchers") }),
  /** A Position of the acting Participant. */
  z.strictObject({ to: z.literal("position"), position: key }),
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
  rules: transitionRules.optional(),
  actions: z.array(transitionAction).optional(),
  notifications: z.array(recipient).optional(),
});
export type WorkflowTransition = z.infer<typeof transition>;

export const workflowDefinition = z.strictObject({
  steps: z.array(step),
  transitions: z.array(transition),
  /** Step positions on the builder's canvas, by Step key. */
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
  /** `{ base_role, permission, positions? }`; `{}` on a terminal Step. */
  actor_rule: Record<string, unknown>;
  /** Dropped by ADR 0017 (every Transition is confirmed and recorded): always written false. */
  is_signing: boolean;
  outcome_mode: "none" | "recommend_code" | "issue_code" | "inspection_result";
  /** Null (left out): the default (RP-514). */
  edits_form?: boolean | null;
  /** On the Draft Step; null (left out): `company`. */
  drafts_visible_to?: DraftsVisibleTo | null;
};

/**
 * A `workflow_transition` row of a Version, its Steps by key. `rules` (WF-7),
 * `actions` (WF-8) and `notifications` (WF-9) are columns, null when it has none.
 * Each is present only when the definition has it.
 */
export type WorkflowTransitionRow = {
  key: string;
  from_step_key: string;
  to_step_key: string;
  label: BilingualText;
  kind: TransitionKind;
  outcome: string | null;
  permission: FunctionPermission;
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
      ...(s.edits_form == null ? {} : { editsForm: s.edits_form }),
      ...(s.drafts_visible_to == null ? {} : { draftsVisibleTo: s.drafts_visible_to }),
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
        ...transitionParts(t),
      })),
    layout: rows.layout,
  });
}

/**
 * A definition as a Version's rows, for a Work Item Type of `outcomeKind`: an
 * issuing Step issues its Inspection Result for a Type with Inspection Results,
 * else its Review Code. Transitions are sorted as listed, from 1. The outcome
 * kind only names the row's `outcome_mode` word: which outcomes a Transition may
 * set is the Type's own outcome set (RP-429), checked at publish (check 3).
 */
export function definitionToRows(definition: WorkflowDefinition, outcomeKind: OutcomeKind): WorkflowVersionRows {
  return {
    layout: definition.layout,
    steps: definition.steps.map((s) => ({
      key: s.key,
      name: s.name,
      stage_key: s.stage,
      actor_rule: s.actor === null ? {} : ruleFromActor(s.actor),
      is_signing: false,
      outcome_mode: s.outcomeMode === "issue_outcome" ? (outcomeKind === "inspection_result" ? "inspection_result" : "issue_code") : s.outcomeMode,
      ...(s.editsForm === undefined ? {} : { edits_form: s.editsForm }),
      ...(s.draftsVisibleTo === undefined ? {} : { drafts_visible_to: s.draftsVisibleTo }),
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
      ...transitionParts(t),
    })),
  };
}

/** An actor rule as stored names its role `base_role`; the definition calls it `role`. */
const actorFromRule = ({ base_role, ...rest }: Record<string, unknown>) => ({ role: base_role, ...rest });
const ruleFromActor = ({ role, ...rest }: ActorRule): Record<string, unknown> => ({ base_role: role, ...rest });

type TransitionParts = Pick<WorkflowTransitionRow, "rules" | "actions" | "notifications">;

/** A Transition's rules, actions and notifications, each only when it has them (same names in rows and definition). */
function transitionParts<T extends TransitionParts>({ rules, actions, notifications }: T): Pick<T, keyof TransitionParts> {
  return {
    ...(rules === undefined ? {} : { rules }),
    ...(actions === undefined ? {} : { actions }),
    ...(notifications === undefined ? {} : { notifications }),
  } as Pick<T, keyof TransitionParts>;
}
