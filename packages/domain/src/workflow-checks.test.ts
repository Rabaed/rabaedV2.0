import { describe, expect, it } from "vitest";
import { formSchema } from "./form.ts";
import { defaultOutcomeSets } from "./outcome.ts";
import { marRows } from "../test/support/mar-workflow.ts";
import { stepEditsForm, workflowPublishProblems, type WorkflowPublishContext } from "./workflow-checks.ts";
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
        { key: "datasheet", type: "attachments", label: { en: "Datasheet", ar: "ورقة البيانات" } },
      ],
    },
    {
      key: "consultant",
      title: { en: "Consultant", ar: "الاستشاري" },
      editable_at: ["consultant_review"],
      fields: [
        { key: "reviewed_on", type: "date", label: { en: "Reviewed on", ar: "تاريخ المراجعة" } },
        { key: "consultant_note", type: "textarea", label: { en: "Consultant note", ar: "ملاحظة الاستشاري" } },
        { key: "reviewer", type: "member", label: { en: "Reviewer", ar: "المراجع" } },
      ],
    },
  ],
});

const context = (over: Partial<WorkflowPublishContext> = {}): WorkflowPublishContext => ({
  outcomes: defaultOutcomeSets.review_code,
  stages: submittalStages,
  form: marForm,
  ...over,
});

/** An Action Form with Code B's table of items (WF-11), of `columns`: by default a comment and a reference. */
const itemsForm = (
  columns: unknown[] = [
    { key: "comment", type: "text", required: true, label: { en: "Comment", ar: "الملاحظة" } },
    { key: "reference", type: "text", label: { en: "Reference", ar: "المرجع" } },
  ],
) => ({
  sections: [
    {
      key: "comments",
      title: { en: "Comments", ar: "الملاحظات" },
      fields: [{ key: "items_to_create", type: "table", minRows: 1, columns, label: { en: "Comments", ar: "الملاحظات" } }],
    },
  ],
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
    expect(workflowPublishProblems(definitionFromRows(marRows(version)), context())).toEqual([]);
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
      add(d, { key: "approve_b", from: "consultant_review", to: "approved", kind: "close", outcome: "B", permission: "approve", actionForm: itemsForm() });
      add(d, { key: "reject_d", from: "consultant_review", to: "rejected", kind: "close", outcome: "D", permission: "approve" });
      expect(problems(d)).toEqual([]);
    });

    describe("an outcome that creates items (Code B's Comments, WF-11) needs its Action Form's table of items", () => {
      const withB = (actionForm: Record<string, unknown> | null) => {
        const d = mar();
        add(d, {
          key: "approve_b",
          label: { en: "Approve with Comments · B", ar: "اعتماد مع ملاحظات · B" },
          from: "consultant_review",
          to: "approved",
          kind: "close",
          outcome: "B",
          permission: "approve",
          actionForm,
        });
        return d;
      };

      it("refuses B with no Action Form, or one without an items_to_create table", () => {
        const missing = [{ code: "items_table_missing", severity: "error", transition: "approve_b" }];
        expect(problems(withB(null))).toEqual(missing);
        const remarksOnly = {
          sections: [{ key: "code", title: { en: "Code", ar: "الرمز" }, fields: [{ key: "remarks", type: "textarea", label: { en: "Remarks", ar: "ملاحظات" } }] }],
        };
        expect(problems(withB(remarksOnly))).toEqual(missing);
      });

      it("refuses a table with no text column: each row's first text cell is its item's Subject", () => {
        const numbersOnly = itemsForm([{ key: "count", type: "number", label: { en: "Count", ar: "العدد" } }]);
        expect(problems(withB(numbersOnly))).toEqual([{ code: "items_table_missing", severity: "error", transition: "approve_b" }]);
      });

      it("asks nothing of an outcome that creates no items, nor of B when the Project's set dropped its action", () => {
        expect(problems(withB(null), context({ outcomes: defaultOutcomeSets.review_code.map((o) => ({ ...o, actions: [] })) }))).toEqual([]);
      });

      it("says so in English and Arabic, naming the Transition and the Type", () => {
        const [problem] = workflowPublishProblems(withB(null), context());
        expect(problem?.message.en).toContain('"Approve with Comments · B"');
        expect(problem?.message.en).toContain("CMT");
        expect(problem?.message.ar).toContain("CMT");
      });
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
      expect(problems(mar(), context({ outcomes: defaultOutcomeSets.inspection_result }))).toEqual([
        { code: "outcome_not_in_set", severity: "error", transition: "approve_a" },
        { code: "outcome_not_in_set", severity: "error", transition: "revise_c" },
      ]);
    });

    it("passes an outcome the Project Admin added to the Type's set (RP-429)", () => {
      const d = mar();
      transition(d, "approve_a").outcome = "E";
      expect(problems(d)).toEqual([{ code: "outcome_not_in_set", severity: "error", transition: "approve_a" }]);
      const e = { code: "E", name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" }, closing: true, polarity: "positive", actions: [] } as const;
      expect(problems(d, context({ outcomes: [...defaultOutcomeSets.review_code, e] }))).toEqual([]);
    });

    it("refuses an outcome of the set that doesn't close the item", () => {
      const d = mar();
      transition(d, "approve_a").outcome = "H";
      const h = { code: "H", name: { en: "On hold", ar: "معلق" }, closing: false, polarity: "negative", actions: [] } as const;
      expect(problems(d, context({ outcomes: [...defaultOutcomeSets.review_code, h] }))).toEqual([
        { code: "outcome_not_in_set", severity: "error", transition: "approve_a" },
      ]);
    });

    it("needs no issuing Step for a Type with one closing outcome", () => {
      const d = mar();
      step(d, "consultant_review").outcomeMode = "none";
      for (const t of d.transitions) if (t.outcome !== null) t.outcome = "closed";
      expect(problems(d, context({ outcomes: defaultOutcomeSets.none }))).toEqual([]);
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

  describe("the raiser's Form is edited only before a Submit, or at a Step a Send Back leads to (ADR 0019)", () => {
    it("by default the Draft Step edits the Form, and the raiser's internal reviewer doesn't", () => {
      const d = mar();
      expect(d.steps.filter((s) => stepEditsForm(d, s, submittalStages)).map((s) => s.key)).toEqual(["draft"]);
      // A raiser's Step held with the Draft Step's Function Permission (the author's) does too.
      addStep(d, { key: "contractor_engineer", stage: "internal_review", actor: { role: "contractor", permission: "create" } });
      expect(stepEditsForm(d, step(d, "contractor_engineer"), submittalStages)).toBe(true);
      // Set on the Step, it is what the Step says.
      step(d, "internal_review").editsForm = true;
      step(d, "draft").editsForm = false;
      expect(stepEditsForm(d, step(d, "internal_review"), submittalStages)).toBe(true);
      expect(stepEditsForm(d, step(d, "draft"), submittalStages)).toBe(false);
    });

    it("passes the raiser's internal reviewer editing before the Submit", () => {
      const d = mar();
      step(d, "internal_review").editsForm = true;
      expect(problems(d)).toEqual([]);
    });

    it("refuses a Step at or after a Submit that edits the Form", () => {
      const d = mar();
      step(d, "consultant_review").editsForm = true;
      expect(problems(d)).toEqual([{ code: "form_edited_after_submit", severity: "error", step: "consultant_review" }]);
      expect(workflowPublishProblems(d, context())[0]!.message).toEqual({
        en: `"Consultant review" edits the raiser's Form, but an item reaches it after a Submit. Only the raiser's Steps an item is Sent Back to may.`,
        ar: `"مراجعة الاستشاري" تعدّل نموذج مُنشئ العنصر، لكن العنصر يصلها بعد التقديم. لا يجوز ذلك إلا لخطوات مُنشئ العنصر بعد الإرجاع إلى المقدّم.`,
      });
    });

    it("passes the raiser's Steps an item is Sent Back to, until the next Submit", () => {
      const d = mar();
      add(d, { key: "send_back", from: "consultant_review", to: "internal_review", kind: "send_back" });
      // Back at the PM, a Return to the Draft reopens it for the engineer holding it.
      step(d, "internal_review").editsForm = true;
      expect(problems(d)).toEqual([]);
    });

    it("refuses a raiser's Step an item reaches after a Submit without a Send Back", () => {
      const d = mar();
      addStep(d, { key: "site_check", stage: "internal_review", actor: { role: "contractor", permission: "create" } });
      add(d, { key: "to_site", from: "consultant_review", to: "site_check" });
      add(d, { key: "back_to_consultant", from: "site_check", to: "consultant_review", kind: "submit" });
      add(d, { key: "send_back", from: "consultant_review", to: "internal_review", kind: "send_back" });
      expect(problems(d)).toContainEqual({ code: "form_edited_after_submit", severity: "error", step: "site_check" });
    });

    it("passes a Return that stays in Internal Review, to the Contractor Engineer Step, which edits the Form (ADR 0020)", () => {
      const d = mar();
      addStep(d, { key: "contractor_engineer", stage: "internal_review", actor: { role: "contractor", permission: "create" } });
      transition(d, "return").to = "contractor_engineer";
      add(d, { key: "send_for_review_again", from: "contractor_engineer", to: "internal_review", permission: "create" });
      expect(problems(d)).toEqual([]);
      expect(d.steps.filter((s) => stepEditsForm(d, s, submittalStages)).map((s) => s.key)).toEqual(["draft", "contractor_engineer"]);
    });

    it("refuses \"Drafts visible to\" on a Step that isn't the Draft Step", () => {
      const d = mar();
      step(d, "draft").draftsVisibleTo = "author";
      expect(problems(d)).toEqual([]);
      step(d, "internal_review").draftsVisibleTo = "company";
      expect(problems(d)).toEqual([{ code: "drafts_visible_to_not_on_draft", severity: "error", step: "internal_review" }]);
    });
  });

  describe("no Workflow names a person: Positions only (a Rabaed Default is copied across Companies too)", () => {
    it("refuses an action setting a Member field to a value", () => {
      const d = mar();
      transition(d, "approve_a").actions = [{ type: "set_field", field: "reviewer", value: "0192f6c5-3c2e-7c4a-9d4e-1a2b3c4d5e6f" }];
      expect(problems(d)).toEqual([{ code: "names_person", severity: "error", transition: "approve_a" }]);
    });

    it("passes Positions, notifying the raiser and watchers, and offering \"Assign to\"", () => {
      const d = mar();
      step(d, "internal_review").actor = { role: "contractor", permission: "review", positions: ["project_manager"] };
      transition(d, "approve_a").notifications = [{ to: "position", position: "project_manager" }, { to: "raiser" }, { to: "watchers" }];
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
      expect(problems(d)).toEqual([]);
    });

    it("refuses a field the Form doesn't have, and an attribute rules can't read", () => {
      const d = mar();
      transition(d, "submit").rules = {
        restrict: [{ type: "condition", condition: { any: [{ field: "colour", op: "=", value: "red" }, { attr: "weather", op: "empty" }] } }],
      };
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["unknown_field", "submit", "colour"],
        ["unknown_attribute", "submit", "weather"],
      ]);
    });

    it("refuses a Restrict on an Action Form answer when no other Transition shares its label: it hides the button, before the pop-up is filled", () => {
      const d = mar();
      transition(d, "revise_c").rules = { restrict: [{ type: "condition", condition: { field: "remarks", op: "not_empty" } }] };
      expect(problems(d)).toEqual([{ code: "unknown_field", severity: "error", transition: "revise_c" }]);
    });

    it("refuses any field when the Type has no Form", () => {
      const d = mar();
      transition(d, "submit").rules = { restrict: [{ type: "condition", condition: { field: "model", op: "not_empty" } }] };
      expect(problems(d, context({ form: null }))).toEqual([{ code: "unknown_field", severity: "error", transition: "submit" }]);
    });

    it("passes separation of duties by Step or Transition, 'been through' the acting Participant's Step or a shared fact, and a Document", () => {
      const d = mar();
      transition(d, "approve_a").rules = {
        restrict: [
          { type: "not_same_person", step: "internal_review" },
          { type: "not_same_person", transition: "submit" },
          { type: "been_through", step: "consultant_review" },
          { type: "been_through", fact: "sent_back" },
          { type: "been_through", fact: "revision" },
        ],
        validate: [{ type: "has_document" }, { type: "has_document", field: "datasheet" }],
      };
      expect(problems(d)).toEqual([]);
    });

    it("refuses a rule on a Step or Transition that isn't there, and 'been through' another Participant's Step", () => {
      const d = mar();
      transition(d, "approve_a").rules = {
        restrict: [
          { type: "not_same_person", step: "manager_review" },
          { type: "not_same_person", transition: "approve_b" },
          { type: "been_through", step: "internal_review" },
        ],
      };
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["unknown_step", "approve_a", "manager_review"],
        ["unknown_transition", "approve_a", "approve_b"],
        ["been_through_other_participant", "approve_a", "internal_review"],
      ]);
    });

    it("refuses a Document rule naming a field that isn't there or isn't a Document field", () => {
      const d = mar();
      transition(d, "approve_a").rules = { validate: [{ type: "has_document", field: "datasheets" }, { type: "has_document", field: "model" }] };
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["unknown_field", "approve_a", "datasheets"],
        ["not_a_document_field", "approve_a", "model"],
      ]);
    });
  });

  describe("actions write only fields the acting Participant fills at that Step (WF-8)", () => {
    it("passes setting and copying the Form fields its Step fills and its own Action Form answers, and \"now\" into a date", () => {
      const d = mar();
      transition(d, "approve_a").actions = [
        { type: "copy_field", from: "remarks", to: "consultant_note" },
        { type: "set_field", field: "reviewed_on", value: { now: true } },
        { type: "set_field", field: "remarks", value: "Approved as submitted." },
      ];
      transition(d, "submit").actions = [{ type: "set_field", field: "note", value: "X" }, { type: "copy_field", from: "model", to: "note" }];
      expect(problems(d)).toEqual([]);
    });

    it("refuses a field another Participant fills, as target or as source, and a field that isn't there", () => {
      const d = mar();
      transition(d, "approve_a").actions = [
        { type: "set_field", field: "model", value: "X" },
        { type: "copy_field", from: "note", to: "consultant_note" },
        { type: "set_field", field: "grade", value: 1 },
      ];
      transition(d, "submit").actions = [{ type: "copy_field", from: "consultant_note", to: "note" }];
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["field_not_filled_at_step", "submit", "consultant_note"],
        ["field_not_filled_at_step", "approve_a", "model"],
        ["field_not_filled_at_step", "approve_a", "note"],
        ["unknown_field", "approve_a", "grade"],
      ]);
    });

    it("refuses copying an internal move's Action Form answer into the Form, which every Participant reads later (V5)", () => {
      const d = mar();
      const forPm = { key: "for_pm", type: "text", label: { en: "For the PM", ar: "إلى مدير المشروع" } };
      const ownCopy = { key: "own_copy", type: "text", label: { en: "Kept", ar: "محفوظ" } };
      transition(d, "send_for_review").actionForm = { sections: [{ key: "to_pm", title: { en: "To the PM", ar: "إلى المدير" }, fields: [forPm, ownCopy] }] };
      transition(d, "send_for_review").actions = [
        { type: "copy_field", from: "for_pm", to: "note" },
        { type: "copy_field", from: "for_pm", to: "own_copy" },
        { type: "copy_field", from: "model", to: "own_copy" },
      ];
      // A Submit's Action Form answers are shared: copying them into the Form is fine.
      transition(d, "submit").actionForm = { sections: [{ key: "to_k1", title: { en: "To K1", ar: "إلى الاستشاري" }, fields: [forPm] }] };
      transition(d, "submit").actions = [{ type: "copy_field", from: "for_pm", to: "note" }];
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([
        ["copy_internal_answer", "send_for_review", "for_pm"],
      ]);
    });

    it("refuses \"now\" into a field that isn't a date or time", () => {
      const d = mar();
      transition(d, "approve_a").actions = [{ type: "set_field", field: "consultant_note", value: { now: true } }];
      expect(workflowPublishProblems(d, context()).map((p) => [p.code, p.transition, p.detail])).toEqual([["now_not_a_date_field", "approve_a", "consultant_note"]]);
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

    it("lets Transitions sharing a label route on an answer every one of their Action Forms asks", () => {
      const estimate = {
        sections: [{ key: "cost", title: { en: "Cost", ar: "التكلفة" }, fields: [{ key: "estimate", type: "number", label: { en: "Estimate", ar: "التقدير" } }] }],
      };
      const d = routed({ field: "estimate", op: "<=", value: 500000 }, { field: "estimate", op: ">", value: 500000 });
      transition(d, "submit").actionForm = estimate;
      transition(d, "submit_high").actionForm = estimate;
      expect(problems(d)).toEqual([{ code: "condition_gap", severity: "warning", transition: "submit" }]);
      transition(d, "submit_high").actionForm = null;
      expect(problems(d)).toEqual([
        { code: "unknown_field", severity: "error", transition: "submit" },
        { code: "unknown_field", severity: "error", transition: "submit_high" },
        { code: "condition_gap", severity: "warning", transition: "submit" },
      ]);
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

    it("names the Action Form's field in both languages, and its English-only problem code in English only", () => {
      const d = mar();
      const remarks = transition(d, "approve_a").actionForm as { sections: { key: string }[] };
      remarks.sections[0]!.key = "remarks";
      expect(workflowPublishProblems(d, context()).map((p) => p.message)).toEqual([
        {
          en: `The Action Form of "Approve · A" isn't a valid Form: "remarks" (duplicate_key).`,
          ar: `النموذج المنبثق لـ "اعتماد · A" ليس نموذجًا صالحًا: "remarks".`,
        },
      ]);
    });

    it("refuses a loop across Participants without a Send Back (check 8)", () => {
      const d = mar();
      add(d, { key: "back_to_contractor", from: "consultant_review", to: "internal_review", kind: "submit" });
      expect(problems(d)).toContainEqual({ code: "loop_across_participants", severity: "error", transition: "back_to_contractor" });
    });
  });

  describe("a Transition showing a Screen (ADR 0019, RP-516)", () => {
    const withScreen = (screen: string, actionForm: Record<string, unknown> | null = null) => {
      const d = mar();
      add(d, {
        key: "approve_b",
        label: { en: "Approve with Comments · B", ar: "اعتماد مع ملاحظات · B" },
        from: "consultant_review",
        to: "approved",
        kind: "close",
        outcome: "B",
        permission: "approve",
        actionForm,
        screen,
      });
      return d;
    };
    const screens = (schema: unknown) => new Map([["code_b_reply", formSchema.parse(schema)]]);

    it("is checked with its Screen's Action Form: Code B's Screen holds the table of items", () => {
      expect(problems(withScreen("code_b_reply"), context({ screens: screens(itemsForm()) }))).toEqual([]);
      const remarksOnly = {
        sections: [{ key: "code", title: { en: "Code", ar: "الرمز" }, fields: [{ key: "remarks", type: "textarea", label: { en: "Remarks", ar: "ملاحظات" } }] }],
      };
      expect(problems(withScreen("code_b_reply"), context({ screens: screens(remarksOnly) }))).toEqual([
        { code: "items_table_missing", severity: "error", transition: "approve_b" },
      ]);
    });

    it("refuses a Screen with no published Version the Workflow's owner uses, and one beside an Action Form of its own", () => {
      expect(problems(withScreen("missing_reply"), context({ screens: screens(itemsForm()) }))).toEqual([
        { code: "screen_not_found", severity: "error", transition: "approve_b" },
        { code: "items_table_missing", severity: "error", transition: "approve_b" },
      ]);
      expect(problems(withScreen("code_b_reply", itemsForm()), context({ screens: screens(itemsForm()) }))).toEqual([
        { code: "screen_with_action_form", severity: "error", transition: "approve_b" },
      ]);
    });

    it("says so in English and Arabic, naming the Transition and the Screen", () => {
      const [found] = workflowPublishProblems(withScreen("missing_reply"), context({ screens: screens(itemsForm()) }));
      expect(found?.message).toEqual({
        en: `"Approve with Comments · B" shows Screen "missing_reply", which has no published Version this Workflow can use.`,
        ar: `يعرض "اعتماد مع ملاحظات · B" الشاشة "missing_reply"، وليس لها إصدار منشور يمكن لسير العمل هذا استخدامه.`,
      });
    });
  });
});
