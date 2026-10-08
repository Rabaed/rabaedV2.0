import type { WorkflowVersionRows } from "../workflow-definition.ts";

// MAR Workflow Versions 1 and 2 as their migrations publish them
// (20260929000000_work_items.sql, 20261029000000_mar_workflow_v2.sql), as rows.

const returnForm = {
  sections: [
    {
      key: "return",
      title: { ar: "إعادة", en: "Return" },
      fields: [
        {
          key: "reason",
          help: { ar: "لا يراه إلا شركتك.", en: "Only your Company sees this." },
          type: "textarea",
          label: { ar: "السبب", en: "Reason" },
          required: true,
          maxLength: 2000,
        },
      ],
    },
  ],
};
const remarksForm = (required: boolean) => ({
  sections: [
    {
      key: "code_remarks",
      title: { ar: "الملاحظات", en: "Remarks" },
      fields: [
        {
          key: "remarks",
          help: { ar: "يراها كل من يرى هذا العنصر.", en: "Shared with everyone who sees this item." },
          type: "textarea",
          label: { ar: "الملاحظات", en: "Remarks" },
          required,
          maxLength: 4000,
        },
      ],
    },
  ],
});

const marSteps: WorkflowVersionRows["steps"] = [
  {
    key: "draft",
    name: { en: "Draft", ar: "مسودة" },
    stage_key: "draft",
    actor_rule: { base_role: "contractor", permission: "create" },
    is_signing: false,
    outcome_mode: "none",
  },
  {
    key: "internal_review",
    name: { en: "Contractor review", ar: "مراجعة المقاول" },
    stage_key: "internal_review",
    actor_rule: { base_role: "contractor", permission: "review" },
    is_signing: false,
    outcome_mode: "none",
  },
  {
    key: "consultant_review",
    name: { en: "Consultant review", ar: "مراجعة الاستشاري" },
    stage_key: "pending_approval",
    actor_rule: { base_role: "consultant", permission: "approve" },
    is_signing: false,
    outcome_mode: "issue_code",
  },
  { key: "approved", name: { en: "Approved", ar: "معتمد" }, stage_key: "approved", actor_rule: {}, is_signing: false, outcome_mode: "none" },
  {
    key: "revise_resubmit",
    name: { en: "Revise & Resubmit", ar: "مراجعة وإعادة تقديم" },
    stage_key: "revise_resubmit",
    actor_rule: {},
    is_signing: false,
    outcome_mode: "none",
  },
];

const marTransitions = (version: 1 | 2): WorkflowVersionRows["transitions"] => [
  {
    key: "send_for_review",
    from_step_key: "draft",
    to_step_key: "internal_review",
    label: { en: "Send for Review", ar: "إرسال للمراجعة" },
    kind: "send",
    outcome: null,
    permission: "create",
    sort: 1,
    action_form: null,
  },
  {
    key: "return",
    from_step_key: "internal_review",
    to_step_key: "draft",
    label: { en: "Return", ar: "إعادة" },
    kind: "return",
    outcome: null,
    permission: "review",
    sort: 2,
    action_form: returnForm,
  },
  {
    key: "submit",
    from_step_key: "internal_review",
    to_step_key: "consultant_review",
    label: { en: "Submit", ar: "تقديم" },
    kind: "submit",
    outcome: null,
    permission: "submit",
    sort: 3,
    action_form: null,
  },
  {
    key: "approve_a",
    from_step_key: "consultant_review",
    to_step_key: "approved",
    label: { en: "Approve · A", ar: "اعتماد · A" },
    kind: "close",
    outcome: "A",
    permission: "approve",
    sort: 4,
    action_form: version === 2 ? remarksForm(false) : null,
  },
  {
    key: "revise_c",
    from_step_key: "consultant_review",
    to_step_key: "revise_resubmit",
    label: { en: "Revise & Resubmit · C", ar: "مراجعة وإعادة تقديم · C" },
    kind: "close",
    outcome: "C",
    permission: "approve",
    sort: 5,
    action_form: version === 2 ? remarksForm(true) : null,
  },
];

/** MAR Workflow Version 1 or 2, as rows. */
export const marRows = (version: 1 | 2): WorkflowVersionRows => ({ layout: {}, steps: marSteps, transitions: marTransitions(version) });
