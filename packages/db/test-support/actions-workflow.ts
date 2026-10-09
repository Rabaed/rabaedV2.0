import { insertTestWorkflow, type RulesTransition, type TestStep } from "./rules-workflow.ts";

/**
 * A test-only Rabaed Workflow whose Transitions carry actions (RP-431, WF-8):
 *
 *   Draft ─send_for_review→ Contractor review ─submit→ Consultant review ─send_to_manager→ Consultant approval ─approve_a→ Approved · A
 *         offer Assign to,     ─return→ Draft        offer Assign to       offer Assign to,                   copy Remarks (Action Form)
 *         set Sent on (now),   offer Assign to       (to another           set Reviewed on (now),             to the Reviewer's note
 *         copy Model to                              Participant: none)    set Verdict "Checked"
 *         Reference                                                         ─return_to_engineer→ Consultant review, offer Assign to
 *
 * Every action writes only fields the acting Participant fills at that Step: the
 * raiser's "Material" section at its own Steps, the Consultant's "Review" section
 * at its Steps, and the Transition's Action Form. It passes every publish check
 * (workflowPublishProblems) with `actionsFormSchema`, as every published Version
 * must. `extra` adds Transitions as given, for a seam-2 test of what publishing
 * would refuse. `run` executes SQL as the migrator; the result is the new
 * Workflow definition's id.
 */
export function addActionsWorkflow(
  run: (text: string) => Promise<{ rows: unknown[] }>,
  { extra = [] }: { extra?: RulesTransition[] } = {},
): Promise<string> {
  return insertTestWorkflow(run, { en: "Actions (test)", ar: "الإجراءات (اختبار)" }, steps, [...transitions, ...extra]);
}

const name = (en: string, ar: string) => ({ en, ar });

/** The Form the actions Workflow is checked with: the raiser's Material, the Consultant's Review. */
export const actionsFormSchema = {
  sections: [
    {
      key: "material",
      title: name("Material", "المادة"),
      fields: [
        { key: "model", type: "text", label: name("Model", "الطراز") },
        { key: "reference", type: "text", label: name("Reference", "المرجع") },
        { key: "sent_on", type: "date", label: name("Sent on", "تاريخ الإرسال") },
      ],
    },
    {
      key: "classification",
      title: name("Classification", "التصنيف"),
      fields: [
        { key: "trade", type: "trade", label: name("Trade", "التخصص") },
        { key: "location", type: "location", label: name("Location", "الموقع") },
        { key: "scopes", type: "scopes", label: name("Scopes", "النطاقات") },
      ],
    },
    {
      key: "review",
      title: name("Review", "المراجعة"),
      editable_at: ["consultant_review", "consultant_approval"],
      fields: [
        { key: "reviewed_on", type: "date", label: name("Reviewed on", "تاريخ المراجعة") },
        { key: "verdict", type: "text", label: name("Verdict", "الحكم") },
        { key: "reviewer_note", type: "textarea", label: name("Reviewer's note", "ملاحظة المراجع") },
      ],
    },
  ],
};

const steps: TestStep[] = [
  { key: "draft", name: name("Draft", "مسودة"), stage_key: "draft", actor_rule: { base_role: "contractor", permission: "create" }, outcome_mode: "none" },
  {
    key: "internal_review",
    name: name("Contractor review", "مراجعة المقاول"),
    stage_key: "internal_review",
    actor_rule: { base_role: "contractor", permission: "review" },
    outcome_mode: "none",
  },
  {
    key: "consultant_review",
    name: name("Consultant review", "مراجعة الاستشاري"),
    stage_key: "pending_approval",
    actor_rule: { base_role: "consultant", permission: "review" },
    outcome_mode: "none",
  },
  {
    key: "consultant_approval",
    name: name("Consultant approval", "اعتماد الاستشاري"),
    stage_key: "pending_approval",
    actor_rule: { base_role: "consultant", permission: "approve" },
    outcome_mode: "issue_code",
  },
  { key: "approved", name: name("Approved", "معتمد"), stage_key: "approved", actor_rule: {}, outcome_mode: "none" },
];

const assignTo = { type: "offer_assign_to" };

const transitions: RulesTransition[] = [
  {
    key: "send_for_review",
    from: "draft",
    to: "internal_review",
    label: name("Send for Review", "إرسال للمراجعة"),
    kind: "send",
    outcome: null,
    permission: "create",
    actions: [assignTo, { type: "set_field", field: "sent_on", value: { now: true } }, { type: "copy_field", from: "model", to: "reference" }],
  },
  {
    key: "return",
    from: "internal_review",
    to: "draft",
    label: name("Return", "إعادة"),
    kind: "return",
    outcome: null,
    permission: "review",
    actions: [assignTo],
  },
  {
    key: "submit",
    from: "internal_review",
    to: "consultant_review",
    label: name("Submit", "تقديم"),
    kind: "submit",
    outcome: null,
    permission: "submit",
    actions: [assignTo],
  },
  {
    key: "send_to_manager",
    from: "consultant_review",
    to: "consultant_approval",
    label: name("Send to Manager", "إرسال للمدير"),
    kind: "send",
    outcome: null,
    permission: "review",
    actions: [assignTo, { type: "set_field", field: "reviewed_on", value: { now: true } }, { type: "set_field", field: "verdict", value: "Checked" }],
  },
  {
    key: "return_to_engineer",
    from: "consultant_approval",
    to: "consultant_review",
    label: name("Return to Engineer", "إعادة للمهندس"),
    kind: "return",
    outcome: null,
    permission: "approve",
    actions: [assignTo],
  },
  {
    key: "approve_a",
    from: "consultant_approval",
    to: "approved",
    label: name("Approve · A", "اعتماد · A"),
    kind: "close",
    outcome: "A",
    permission: "approve",
    action_form: {
      sections: [{ key: "code_a", title: name("Approve", "اعتماد"), fields: [{ key: "remarks", type: "textarea", label: name("Remarks", "الملاحظات") }] }],
    },
    actions: [{ type: "copy_field", from: "remarks", to: "reviewer_note" }],
  },
];
