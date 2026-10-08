import { describe, expect, it } from "vitest";
import { formSchema } from "./form.ts";
import { marRows } from "./test-support/mar-workflow.ts";
import { workflowPublishProblems, type WorkflowPublishContext } from "./workflow-checks.ts";
import { definitionFromRows, type WorkflowDefinition, type WorkflowStep, type WorkflowTransition } from "./workflow-definition.ts";

// Pure domain: every publish check of workflow-engine.md §1 (but check 5, dropped
// by ADR 0017), plus the ones spec RP-423 adds (RP-425). Each check passes the MAR
// and fails a definition broken for it; each problem names its Step or
// Transition, with a stable code and an English and Arabic message.

const submittalStages: WorkflowPublishContext["stages"] = [
  { key: "draft", category: "draft" },
  { key: "internal_review", category: "in_progress" },
  { key: "pending_approval", category: "in_progress" },
  { key: "approved", category: "closed_positive" },
  { key: "revise_resubmit", category: "closed_negative" },
  { key: "rejected", category: "closed_negative" },
  { key: "cancelled", category: "cancelled" },
];

const marForm = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
        { key: "cost_impact", type: "number", label: { en: "Cost impact", ar: "الأثر المالي" } },
        { key: "note", type: "textarea", label: { en: "Note", ar: "ملاحظة" } },
      ],
    },
  ],
});

const context = (over: Partial<WorkflowPublishContext> = {}): WorkflowPublishContext => ({
  ownerKind: "project",
  outcomeKind: "review_code",
  stages: submittalStages,
  form: marForm,
  ...over,
});

/** MAR Workflow Version 2, a fresh copy to break. */
const mar = (): WorkflowDefinition => definitionFromRows(marRows(2));

const step = (definition: WorkflowDefinition, key: string): WorkflowStep => definition.steps.find((s) => s.key === key)!;
const transition = (definition: WorkflowDefinition, key: string): WorkflowTransition => definition.transitions.find((t) => t.key === key)!;
const add = (definition: WorkflowDefinition, t: Partial<WorkflowTransition> & Pick<WorkflowTransition, "key" | "from" | "to">) =>
  definition.transitions.push({ label: { en: t.key, ar: t.key }, kind: "send", outcome: null, permission: "review", actionForm: null, ...t });
const addStep = (definition: WorkflowDefinition, s: Partial<WorkflowStep> & Pick<WorkflowStep, "key" | "stage">) =>
  definition.steps.push({ name: { en: s.key, ar: s.key }, actor: null, outcomeMode: "none", ...s });

/** The problems' codes with what they concern, for comparing. */
const problems = (definition: WorkflowDefinition, ctx = context()) =>
  workflowPublishProblems(definition, ctx).map(({ code, severity, step: s, transition: t }) => ({
    code,
    severity,
    ...(s === undefined ? {} : { step: s }),
    ...(t === undefined ? {} : { transition: t }),
  }));

describe("workflowPublishProblems", () => {
  it.each([1, 2] as const)("passes MAR Version %i", (version) => {
    expect(workflowPublishProblems(definitionFromRows(marRows(version)), context({ ownerKind: "rabaed" }))).toEqual([]);
  });

  describe("check 1: one Draft start Step, every Step reachable, no dead end", () => {
    it("refuses a Workflow with no Draft Step", () => {
      const d = mar();
      step(d, "draft").stage = "internal_review";
      expect(problems(d)).toContainEqual({ code: "no_draft_step", severity: "error" });
    });

    it("refuses a second Draft Step", () => {
      const d = mar();
      addStep(d, { key: "second_draft", stage: "draft", actor: { role: "contractor", permission: "create" } });
      add(d, { key: "second_send", from: "second_draft", to: "internal_review" });
      expect(problems(d)).toContainEqual({ code: "several_draft_steps", severity: "error", step: "second_draft" });
    });

    it("refuses a Step the Draft never reaches", () => {
      const d = mar();
      addStep(d, { key: "rejected", stage: "rejected" });
      expect(problems(d)).toEqual([{ code: "unreachable_step", severity: "error", step: "rejected" }]);
    });

    it("refuses an open Step with no way out", () => {
      const d = mar();
      addStep(d, { key: "owner_review", stage: "pending_approval", actor: { role: "owner", permission: "review" } });
      add(d, { key: "to_owner", from: "consultant_review", to: "owner_review", kind: "submit" });
      expect(problems(d)).toContainEqual({ code: "dead_end_step", severity: "error", step: "owner_review" });
    });

    it("refuses an open Step nobody may hold", () => {
      const d = mar();
      step(d, "internal_review").actor = null;
      expect(problems(d)).toContainEqual({ code: "step_without_actor", severity: "error", step: "internal_review" });
    });

    it("refuses two Steps or two Transitions with one key, and a Transition to a Step that isn't there", () => {
      const d = mar();
      addStep(d, { key: "approved", stage: "approved" });
      add(d, { key: "submit", from: "draft", to: "internal_review" });
      add(d, { key: "to_nowhere", from: "draft", to: "nowhere" });
      expect(problems(d)).toEqual(
        expect.arrayContaining([
          { code: "duplicate_step", severity: "error", step: "approved" },
          { code: "duplicate_transition", severity: "error", transition: "submit" },
          { code: "unknown_step", severity: "error", transition: "to_nowhere" },
        ]),
      );
    });
  });

  describe("check 2: every Step in a Stage of the Module, terminal Steps in closed or cancelled Stages", () => {
    it("refuses a Stage the Module doesn't have", () => {
      const d = mar();
      step(d, "internal_review").stage = "site_check";
      expect(problems(d)).toEqual([{ code: "unknown_stage", severity: "error", step: "internal_review" }]);
    });

    it("refuses a Transition out of a closed Step", () => {
      const d = mar();
      add(d, { key: "reopen", from: "approved", to: "consultant_review", kind: "return" });
      expect(problems(d)).toContainEqual({ code: "terminal_step_has_transitions", severity: "error", transition: "reopen" });
    });
  });

  describe("check 3: closing Transitions set an outcome of the Work Item Type's set", () => {
    it("passes Codes B and D beside A and C", () => {
      const d = mar();
      addStep(d, { key: "rejected", stage: "rejected" });
      add(d, { key: "approve_b", from: "consultant_review", to: "approved", kind: "close", outcome: "B", permission: "approve" });
      add(d, { key: "reject_d", from: "consultant_review", to: "rejected", kind: "close", outcome: "D", permission: "approve" });
      expect(problems(d)).toEqual([]);
    });

    it("refuses a closing Transition with no outcome", () => {
      const d = mar();
      transition(d, "approve_a").outcome = null;
      expect(problems(d)).toEqual([{ code: "missing_outcome", severity: "error", transition: "approve_a" }]);
    });

    it("refuses an outcome outside the Type's set: an Inspection Result on a submittal, a Code on an Inspection", () => {
      const d = mar();
      transition(d, "approve_a").outcome = "passed";
      expect(problems(d)).toEqual([{ code: "outcome_not_in_set", severity: "error", transition: "approve_a" }]);
      expect(problems(mar(), context({ outcomeKind: "inspection_result" }))).toEqual([
        { code: "outcome_not_in_set", severity: "error", transition: "approve_a" },
        { code: "outcome_not_in_set", severity: "error", transition: "revise_c" },
      ]);
    });

    it("refuses an outcome on a Transition to an open Step, and a close to an open Step", () => {
      const d = mar();
      transition(d, "submit").outcome = "A";
      add(d, { key: "close_early", from: "consultant_review", to: "consultant_review", kind: "close" });
      expect(problems(d)).toEqual(
        expect.arrayContaining([
          { code: "outcome_on_open_step", severity: "error", transition: "submit" },
          { code: "close_to_open_step", severity: "error", transition: "close_early" },
        ]),
      );
    });

    it("refuses a Code issued from a Step that doesn't issue the outcome", () => {
      const d = mar();
      add(d, { key: "approve_early", from: "internal_review", to: "approved", kind: "close", outcome: "A" });
      expect(problems(d)).toEqual([{ code: "outcome_not_from_issuing_step", severity: "error", transition: "approve_early" }]);
    });

    it("refuses a Review Code Type's Workflow with no Step issuing the Code", () => {
      const d = mar();
      step(d, "consultant_review").outcomeMode = "none";
      expect(problems(d)).toContainEqual({ code: "no_issuing_step", severity: "error" });
    });

    it("refuses a Transition other than a close or Cancel into a closed Step", () => {
      const d = mar();
      transition(d, "approve_a").kind = "send";
      expect(problems(d)).toEqual([{ code: "ends_without_close", severity: "error", transition: "approve_a" }]);
    });
  });

  describe("Cancel: only from the raiser's own Steps, to a cancelled Stage, with no outcome", () => {
    const withCancel = (from: string) => {
      const d = mar();
      addStep(d, { key: "cancelled", stage: "cancelled" });
      add(d, { key: "cancel", from, to: "cancelled", kind: "cancel", permission: "create" });
      return d;
    };

    it("passes a Cancel from the raiser's Steps", () => {
      const d = withCancel("draft");
      add(d, { key: "cancel_at_review", from: "internal_review", to: "cancelled", kind: "cancel" });
      expect(problems(d)).toEqual([]);
    });

    it("refuses a Cancel from another Participant's Step", () => {
      expect(problems(withCancel("consultant_review"))).toEqual([{ code: "cancel_not_by_raiser", severity: "error", transition: "cancel" }]);
    });

    it("refuses a Cancel into a Stage that isn't cancelled, or setting an outcome", () => {
      const d = withCancel("draft");
      transition(d, "cancel").to = "approved";
      transition(d, "cancel").outcome = "A";
      expect(problems(d)).toEqual(
        expect.arrayContaining([
          { code: "cancel_not_to_cancelled_stage", severity: "error", transition: "cancel" },
          { code: "cancel_sets_outcome", severity: "error", transition: "cancel" },
        ]),
      );
    });
  });

  describe("a Library or Project Workflow names no person (Positions only)", () => {
    const member = "0192f6c5-3c2e-7c4a-9d4e-1a2b3c4d5e6f";
    const naming = () => {
      const d = mar();
      step(d, "internal_review").actor = { role: "contractor", permission: "review", member };
      transition(d, "submit").actions = [{ type: "assign_to", member }];
      transition(d, "approve_a").notifications = [{ to: "member", member }];
      return d;
    };

    it.each(["project", "company"] as const)("refuses a person named in a %s Workflow's actor rule, assignment or notification", (ownerKind) => {
      expect(problems(naming(), context({ ownerKind }))).toEqual([
        { code: "names_person", severity: "error", step: "internal_review" },
        { code: "names_person", severity: "error", transition: "submit" },
        { code: "names_person", severity: "error", transition: "approve_a" },
      ]);
    });

    it("passes Positions", () => {
      const d = mar();
      step(d, "internal_review").actor = { role: "contractor", permission: "review", positions: ["project_manager"] };
      transition(d, "approve_a").notifications = [{ to: "position", position: "project_manager" }, { to: "raiser" }];
      transition(d, "submit").actions = [{ type: "offer_assign_to" }];
      expect(problems(d)).toEqual([]);
    });
  });

  describe("check 6: rules and conditions read fields the Form's latest published Version has", () => {
    it("passes rules on Form fields, Action Form answers (Validate) and item attributes", () => {
      const d = mar();
      transition(d, "submit").rules = {
        restrict: [{ type: "condition", condition: { all: [{ field: "cost_impact", op: "<=", value: 500000 }, { attr: "trade", op: "in", value: ["EL"] }] } }],
      };
      transition(d, "revise_c").rules = {
        validate: [{ type: "condition", condition: { field: "remarks", op: "not_empty" }, message: { en: "Write Remarks.", ar: "اكتب الملاحظات." } }],
      };
      transition(d, "approve_a").actions = [{ type: "copy_field", from: "remarks", to: "note" }, { type: "set_field", field: "model", value: "X" }];
      expect(problems(d)).toEqual([]);
    });

    it("refuses a field the Form doesn't have, and an attribute rules can't read", () => {
      const d = mar();
      transition(d, "submit").rules = {
        restrict: [{ type: "condition", condition: { any: [{ field: "colour", op: "=", value: "red" }, { attr: "weather", op: "empty" }] } }],
      };
      transition(d, "approve_a").actions = [{ type: "set_field", field: "grade", value: 1 }];
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["unknown_field", "submit", "colour"],
        ["unknown_attribute", "submit", "weather"],
        ["unknown_field", "approve_a", "grade"],
      ]);
    });

    it("refuses a Restrict on an Action Form answer: it is read before the pop-up is filled", () => {
      const d = mar();
      transition(d, "revise_c").rules = { restrict: [{ type: "condition", condition: { field: "remarks", op: "not_empty" } }] };
      expect(problems(d)).toEqual([{ code: "unknown_field", severity: "error", transition: "revise_c" }]);
    });

    it("refuses any field when the Type has no Form", () => {
      const d = mar();
      transition(d, "submit").rules = { restrict: [{ type: "condition", condition: { field: "model", op: "not_empty" } }] };
      expect(problems(d, context({ form: null }))).toEqual([{ code: "unknown_field", severity: "error", transition: "submit" }]);
    });

    it("refuses a rule on a Step that isn't there, and 'been through' another Participant's Step", () => {
      const d = mar();
      transition(d, "approve_a").rules = {
        restrict: [
          { type: "not_same_person", step: "manager_review" },
          { type: "been_through", step: "internal_review" },
        ],
      };
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["unknown_step", "approve_a", "manager_review"],
        ["been_through_other_participant", "approve_a", "internal_review"],
      ]);
    });
  });

  describe("conditions among Transitions sharing a label and source Step: overlap or gap is a warning (§4)", () => {
    /** The MAR's Submit split by cost impact, to the Consultant or to the Owner Representative. */
    const routed = (low: Parameters<typeof transitionCondition>[0], high: Parameters<typeof transitionCondition>[0]) => {
      const d = mar();
      addStep(d, { key: "owner_rep_review", stage: "pending_approval", actor: { role: "owner_representative", permission: "approve" }, outcomeMode: "issue_outcome" });
      transition(d, "submit").rules = transitionCondition(low);
      add(d, { key: "submit_high", from: "internal_review", to: "owner_rep_review", kind: "submit", label: transition(d, "submit").label, rules: transitionCondition(high) });
      add(d, { key: "owner_rep_approve", from: "owner_rep_review", to: "approved", kind: "close", outcome: "A", permission: "approve" });
      return d;
    };
    function transitionCondition(rule: { field: string; op: ">" | "<=" | "<" | ">="; value: number } | null): WorkflowTransition["rules"] {
      return rule === null ? undefined : { restrict: [{ type: "condition", condition: rule }] };
    }

    it("passes conditions that pick exactly one, whatever the answer", () => {
      const d = routed({ field: "cost_impact", op: "<=", value: 500000 }, { field: "cost_impact", op: ">", value: 500000 });
      // An empty cost impact matches neither: a gap, unless one of them takes it.
      transition(d, "submit").rules = {
        restrict: [{ type: "condition", condition: { any: [{ field: "cost_impact", op: "<=", value: 500000 }, { field: "cost_impact", op: "empty" }] } }],
      };
      expect(problems(d)).toEqual([]);
    });

    it("warns when both can match", () => {
      const d = routed(null, { field: "cost_impact", op: ">=", value: 500000 });
      transition(d, "submit").rules = {
        restrict: [{ type: "condition", condition: { any: [{ field: "cost_impact", op: "<=", value: 500000 }, { field: "cost_impact", op: "empty" }] } }],
      };
      expect(problems(d)).toEqual([{ code: "condition_overlap", severity: "warning", transition: "submit" }]);
    });

    it("warns when an answer matches none", () => {
      const d = routed({ field: "cost_impact", op: "<", value: 500000 }, { field: "cost_impact", op: ">", value: 500000 });
      expect(problems(d)).toEqual([{ code: "condition_gap", severity: "warning", transition: "submit" }]);
    });

    it("warns that a Transition without a condition overlaps every other", () => {
      const d = routed(null, { field: "cost_impact", op: ">", value: 500000 });
      expect(problems(d)).toEqual([{ code: "condition_overlap", severity: "warning", transition: "submit" }]);
    });

    it("leaves Transitions with different labels alone", () => {
      const d = routed(null, null);
      transition(d, "submit_high").label = { en: "Submit to the Owner Representative", ar: "تقديم إلى ممثل المالك" };
      expect(problems(d)).toEqual([]);
    });
  });

  it("gives every problem its message in English and Arabic, with the Step or Transition's own name", () => {
    const d = mar();
    transition(d, "approve_a").outcome = null;
    step(d, "internal_review").stage = "site_check";
    const [stage, outcome] = workflowPublishProblems(d, context());
    expect(stage?.message).toEqual({
      en: `"Contractor review" is in Stage "site_check", which this Module doesn't have.`,
      ar: `"مراجعة المقاول" في المرحلة "site_check"، وهي ليست من مراحل هذه الوحدة.`,
    });
    expect(outcome?.message).toEqual({
      en: `"Approve · A" closes the item, so it needs an outcome.`,
      ar: `"اعتماد · A" يُغلق العنصر، لذا يحتاج إلى نتيجة.`,
    });
  });

  describe("checks 4, 7 and 8, as built", () => {
    it("refuses a Return across Participants and a Submit inside one (check 4)", () => {
      const d = mar();
      transition(d, "return").to = "consultant_review";
      transition(d, "send_for_review").kind = "submit";
      expect(problems(d)).toEqual(
        expect.arrayContaining([
          { code: "return_crosses_participants", severity: "error", transition: "return" },
          { code: "submit_stays_inside", severity: "error", transition: "send_for_review" },
        ]),
      );
    });

    it("refuses an Action Form that isn't a valid Form schema (check 7)", () => {
      const d = mar();
      transition(d, "submit").actionForm = { sections: [] };
      expect(problems(d)).toEqual([{ code: "invalid_action_form", severity: "error", transition: "submit" }]);
    });

    it("refuses a loop across Participants without a Send Back (check 8)", () => {
      const d = mar();
      add(d, { key: "back_to_contractor", from: "consultant_review", to: "internal_review", kind: "submit" });
      expect(problems(d)).toContainEqual({ code: "loop_across_participants", severity: "error", transition: "back_to_contractor" });
    });
  });
});
