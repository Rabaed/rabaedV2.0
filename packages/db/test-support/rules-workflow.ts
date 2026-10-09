/**
 * A test-only Rabaed Workflow whose Transitions carry Restrict and Validate rules
 * (RP-430, WF-7), one rule per Transition so each can be seen to hold or not:
 *
 *   Draft ─send_for_review→ Contractor review ─submit (and its ruled twins)→ Consultant review
 *   Draft ─submit_direct→ Consultant review        been through Contractor review
 *   Contractor review ─return→ Draft
 *   Contractor review ─submit_separate→           not the Member who left the Draft
 *                     ─resubmit→                  been Sent Back (a shared fact)
 *                     ─submit_revision→           is a Revision (a shared fact)
 *                     ─submit_documented→         validate: a file in Datasheet
 *                     ─submit_any_document→       validate: any Document
 *                     ─submit_costed→             validate: the cost impact is given
 *   Consultant review ─send_back→ Contractor review    Positions: manager only
 *                     ─send_to_manager→ Consultant approval  ┐ one label, "Send to Manager":
 *                     ─send_to_senior→ Senior approval       ┘ cost impact over 500,000 goes to Senior
 *                     ─escalate→ Consultant approval  validate: the Form is complete
 *   Consultant approval ─return_to_engineer→ Consultant review
 *                       ─approve_a→ Approved · A       not the Member who took send_to_manager
 *                       ─revise_c→ Revise · C          validate: Remarks given (Action Form)
 *                       ─reject_d→ Revise · D          all Comments closed
 *   Senior approval ─senior_approve_a→ Approved · A, ─return_from_senior→ Consultant review
 *
 * The manager's verdict (Form, required over a 1,000,000 cost impact) is filled at
 * either approval, so "Escalate" can be refused while it is missing.
 *
 * It passes every publish check (workflowPublishProblems) with `rulesFormSchema`,
 * as every published Version must. `extra` adds Transitions as given, for a seam-2
 * test of what publishing would refuse. `run` executes SQL as the migrator; the
 * result is the new Workflow definition's id.
 */
export function addRulesWorkflow(
  run: (text: string) => Promise<{ rows: unknown[] }>,
  { extra = [] }: { extra?: RulesTransition[] } = {},
): Promise<string> {
  return insertTestWorkflow(run, { en: "Rules (test)", ar: "القواعد (اختبار)" }, steps, [...transitions, ...extra]);
}

/** A Step as insertTestWorkflow takes it: a `workflow_step` row, by key. */
export type TestStep = { key: string; name: { en: string; ar: string }; stage_key: string; actor_rule: object; outcome_mode: string };

/**
 * Inserts a Rabaed Workflow named `workflowName` with these Steps and Transitions
 * (their rules and actions too) as Version 1, built as a draft, then published.
 * `run` executes SQL as the migrator; the result is the Workflow definition's id.
 */
export async function insertTestWorkflow(
  run: (text: string) => Promise<{ rows: unknown[] }>,
  workflowName: { en: string; ar: string },
  steps: readonly TestStep[],
  transitions: readonly RulesTransition[],
): Promise<string> {
  const definition = JSON.stringify({ steps, transitions });
  const { rows } = await run(`
    with input as (select $json$${definition}$json$::jsonb as d),
    definition as (
      insert into workflow_definition (owner_kind, name)
      values ('rabaed', $json$${JSON.stringify(workflowName)}$json$::jsonb)
      returning id
    ), version as (
      insert into workflow_version (workflow_definition_id, version_no, status)
      select id, 1, 'draft' from definition
      returning id
    ), steps as (
      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode)
      select version.id, s.key, s.name, s.stage_key, s.actor_rule, s.outcome_mode
      from version, input, jsonb_to_recordset(input.d -> 'steps') as s (key text, name jsonb, stage_key text, actor_rule jsonb, outcome_mode text)
      returning id, key, workflow_version_id
    ), transitions as (
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form, rules, actions)
      select f.workflow_version_id, t.key, f.id, s.id, t.label, t.kind, t.outcome, t.permission, t.n::integer, t.action_form, t.rules, t.actions
      from input
      cross join rows from (
        jsonb_to_recordset(input.d -> 'transitions') as (
          key text, "from" text, "to" text, label jsonb, kind text, outcome text, permission text, action_form jsonb, rules jsonb, actions jsonb)
      ) with ordinality as t (key, "from", "to", label, kind, outcome, permission, action_form, rules, actions, n)
      join steps f on f.key = t."from"
      join steps s on s.key = t."to"
      returning id
    )
    select id from definition where (select count(*) from transitions) > 0
  `);
  const id = (rows[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("insertTestWorkflow: nothing inserted");
  // Built as a draft, then published: a published Version takes no new parts (RP-424).
  await run(`update workflow_version set status = 'published', published_at = now() where workflow_definition_id = '${id}'`);
  return id;
}

/** A Transition as addRulesWorkflow takes it. */
export type RulesTransition = {
  key: string;
  from: string;
  to: string;
  label: { en: string; ar: string };
  kind: string;
  outcome: string | null;
  permission: string;
  action_form?: unknown;
  rules?: unknown;
  actions?: unknown;
};

/** The Form the rules Workflow is checked with: the cost impact and Datasheet it reads, and the manager's verdict. */
export const rulesFormSchema = {
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
        { key: "cost", type: "number", label: { en: "Cost impact", ar: "الأثر المالي" } },
        { key: "datasheet", type: "attachments", label: { en: "Datasheet", ar: "نشرة البيانات" } },
      ],
    },
    {
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
    {
      key: "review",
      title: { en: "Review", ar: "المراجعة" },
      editable_at: ["consultant_approval", "senior_approval"],
      // Required for a cost impact over 1,000,000, which goes to the Senior approval.
      fields: [{ key: "verdict", type: "text", required: { field: "cost", op: ">", value: 1_000_000 }, label: { en: "Verdict", ar: "الحكم" } }],
    },
  ],
};

const name = (en: string, ar: string) => ({ en, ar });

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
  {
    key: "senior_approval",
    name: name("Senior approval", "اعتماد كبير المهندسين"),
    stage_key: "pending_approval",
    actor_rule: { base_role: "consultant", permission: "approve" },
    outcome_mode: "issue_code",
  },
  { key: "approved", name: name("Approved", "معتمد"), stage_key: "approved", actor_rule: {}, outcome_mode: "none" },
  { key: "revise_resubmit", name: name("Revise & Resubmit", "مراجعة وإعادة تقديم"), stage_key: "revise_resubmit", actor_rule: {}, outcome_mode: "none" },
];

const submit = (key: string, en: string, ar: string, rules: unknown): RulesTransition => ({
  key,
  from: "internal_review",
  to: "consultant_review",
  label: name(en, ar),
  kind: "submit",
  outcome: null,
  permission: "submit",
  rules,
});

const bigCost = { field: "cost", op: ">", value: 500000 };

const transitions: RulesTransition[] = [
  { key: "send_for_review", from: "draft", to: "internal_review", label: name("Send for Review", "إرسال للمراجعة"), kind: "send", outcome: null, permission: "create" },
  {
    key: "submit_direct",
    from: "draft",
    to: "consultant_review",
    label: name("Submit directly", "تقديم مباشر"),
    kind: "submit",
    outcome: null,
    permission: "submit",
    rules: { restrict: [{ type: "been_through", step: "internal_review" }] },
  },
  { key: "return", from: "internal_review", to: "draft", label: name("Return", "إعادة"), kind: "return", outcome: null, permission: "review" },
  submit("submit", "Submit", "تقديم", undefined),
  submit("submit_separate", "Submit (second pair of eyes)", "تقديم (بعين ثانية)", { restrict: [{ type: "not_same_person", step: "draft" }] }),
  submit("resubmit", "Resubmit", "إعادة التقديم", { restrict: [{ type: "been_through", fact: "sent_back" }] }),
  submit("submit_revision", "Submit Revision", "تقديم المراجعة", { restrict: [{ type: "been_through", fact: "revision" }] }),
  submit("submit_documented", "Submit with Datasheet", "تقديم مع نشرة البيانات", { validate: [{ type: "has_document", field: "datasheet" }] }),
  submit("submit_any_document", "Submit with a Document", "تقديم مع مستند", { validate: [{ type: "has_document" }] }),
  submit("submit_costed", "Submit with cost", "تقديم مع التكلفة", {
    validate: [
      {
        type: "condition",
        condition: { field: "cost", op: "not_empty" },
        message: name("Enter the cost impact before you submit.", "أدخل الأثر المالي قبل التقديم."),
      },
    ],
  }),
  {
    key: "send_back",
    from: "consultant_review",
    to: "internal_review",
    label: name("Send Back", "إرجاع إلى المقدّم"),
    kind: "send_back",
    outcome: null,
    permission: "review",
    rules: { restrict: [{ type: "positions", positions: ["manager"] }] },
  },
  {
    key: "send_to_manager",
    from: "consultant_review",
    to: "consultant_approval",
    label: name("Send to Manager", "إرسال للمدير"),
    kind: "send",
    outcome: null,
    permission: "review",
    rules: { restrict: [{ type: "condition", condition: { not: bigCost } }] },
  },
  {
    key: "send_to_senior",
    from: "consultant_review",
    to: "senior_approval",
    label: name("Send to Manager", "إرسال للمدير"),
    kind: "send",
    outcome: null,
    permission: "review",
    rules: { restrict: [{ type: "condition", condition: bigCost }] },
  },
  {
    key: "escalate",
    from: "consultant_review",
    to: "consultant_approval",
    label: name("Escalate with the verdict", "تصعيد مع الحكم"),
    kind: "send",
    outcome: null,
    permission: "review",
    rules: { validate: [{ type: "form_complete" }] },
  },
  {
    key: "return_to_engineer",
    from: "consultant_approval",
    to: "consultant_review",
    label: name("Return to Engineer", "إعادة للمهندس"),
    kind: "return",
    outcome: null,
    permission: "approve",
  },
  {
    key: "approve_a",
    from: "consultant_approval",
    to: "approved",
    label: name("Approve · A", "اعتماد · A"),
    kind: "close",
    outcome: "A",
    permission: "approve",
    rules: { restrict: [{ type: "not_same_person", transition: "send_to_manager" }] },
  },
  {
    key: "revise_c",
    from: "consultant_approval",
    to: "revise_resubmit",
    label: name("Revise · C", "مراجعة · C"),
    kind: "close",
    outcome: "C",
    permission: "approve",
    action_form: {
      sections: [
        {
          key: "code_c",
          title: name("Revise & Resubmit", "مراجعة وإعادة تقديم"),
          fields: [{ key: "remarks", type: "textarea", label: name("Remarks", "الملاحظات") }],
        },
      ],
    },
    rules: {
      validate: [
        { type: "condition", condition: { field: "remarks", op: "not_empty" }, message: name("Write the Remarks for Code C.", "اكتب ملاحظات الرمز C.") },
      ],
    },
  },
  {
    key: "reject_d",
    from: "consultant_approval",
    to: "revise_resubmit",
    label: name("Reject · D", "رفض · D"),
    kind: "close",
    outcome: "D",
    permission: "approve",
    rules: { restrict: [{ type: "all_closed", items: "comments" }] },
  },
  {
    key: "senior_approve_a",
    from: "senior_approval",
    to: "approved",
    label: name("Approve · A", "اعتماد · A"),
    kind: "close",
    outcome: "A",
    permission: "approve",
  },
  {
    key: "return_from_senior",
    from: "senior_approval",
    to: "consultant_review",
    label: name("Return to Engineer", "إعادة للمهندس"),
    kind: "return",
    outcome: null,
    permission: "approve",
  },
];
