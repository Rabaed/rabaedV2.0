import { insertTestWorkflow, type RulesTransition, type TestStep } from "./rules-workflow.ts";
import { approveBActionForm } from "./test-workflow.ts";

/**
 * A test-only Rabaed Workflow ending with the Owner's review (ADR 0022, RP-593), the
 * DAR's 1→1→1: the Contractor PM Submits, the Consultant PM Recommends a Code to the
 * Owner (a Submit carrying the Code), and the Owner confirms it (one "Confirm" button,
 * a close per Code, the engine offering the one Recommended) or Sends it Back:
 *
 *   Draft ─send_for_review→ Contractor review ─submit→ Consultant PM (Recommends a Code)
 *   Consultant PM ─recommend_a / _b / _c / _d (Submit, the Code)→ Owner review (confirms it)
 *   Owner review ─confirm_a / _b→ Approved, ─confirm_c→ Revise & Resubmit, ─confirm_d→ Rejected
 *   Owner review ─owner_send_back→ Consultant PM
 *
 * Code B's Recommendation carries its table of items (approveBActionForm), from which
 * the Owner's Confirm creates the Comments. The Owner review is held by the Owner, or by
 * an Owner Representative covering the item where the Project has one. It passes every
 * publish check. `run` executes SQL as the migrator; the result is the Workflow's id.
 */
export function addOwnerReviewWorkflow(run: (text: string) => Promise<{ rows: unknown[] }>): Promise<string> {
  return insertTestWorkflow(run, { en: "Owner's review (test)", ar: "مراجعة المالك (اختبار)" }, ownerReviewSteps, ownerReviewTransitions);
}

const name = (en: string, ar: string) => ({ en, ar });

export const ownerReviewSteps: TestStep[] = [
  { key: "draft", name: name("Draft", "مسودة"), stage_key: "draft", actor_rule: { base_role: "contractor", permission: "create" }, outcome_mode: "none" },
  {
    key: "internal_review",
    name: name("Contractor review", "مراجعة المقاول"),
    stage_key: "internal_review",
    actor_rule: { base_role: "contractor", permission: "review" },
    outcome_mode: "none",
  },
  {
    key: "consultant_pm",
    name: name("Consultant PM review", "مراجعة مدير الاستشاري"),
    stage_key: "pending_approval",
    actor_rule: { base_role: "consultant", permission: "approve" },
    outcome_mode: "recommend_code",
  },
  {
    key: "owner_review",
    name: name("Owner review", "مراجعة المالك"),
    stage_key: "pending_approval",
    actor_rule: { base_role: "owner", permission: "approve" },
    outcome_mode: "confirm_code",
  },
  { key: "approved", name: name("Approved", "معتمد"), stage_key: "approved", actor_rule: {}, outcome_mode: "none" },
  { key: "revise_resubmit", name: name("Revise & Resubmit", "مراجعة وإعادة تقديم"), stage_key: "revise_resubmit", actor_rule: {}, outcome_mode: "none" },
  { key: "rejected", name: name("Rejected", "مرفوض"), stage_key: "rejected", actor_rule: {}, outcome_mode: "none" },
];

const recommend = (code: string): RulesTransition => ({
  key: `recommend_${code.toLowerCase()}`,
  from: "consultant_pm",
  to: "owner_review",
  label: name(`Recommend ${code}`, `التوصية بـ ${code}`),
  kind: "submit",
  outcome: code,
  permission: "approve",
  ...(code === "B" ? { action_form: approveBActionForm } : {}),
});

const confirm = (code: string, to: string): RulesTransition => ({
  key: `confirm_${code.toLowerCase()}`,
  from: "owner_review",
  to,
  label: name("Confirm", "تأكيد"),
  kind: "close",
  outcome: code,
  permission: "approve",
});

export const ownerReviewTransitions: RulesTransition[] = [
  { key: "send_for_review", from: "draft", to: "internal_review", label: name("Send for Review", "إرسال للمراجعة"), kind: "send", outcome: null, permission: "create" },
  { key: "submit", from: "internal_review", to: "consultant_pm", label: name("Submit", "تقديم"), kind: "submit", outcome: null, permission: "submit" },
  ...["A", "B", "C", "D"].map(recommend),
  confirm("A", "approved"),
  confirm("B", "approved"),
  confirm("C", "revise_resubmit"),
  confirm("D", "rejected"),
  {
    key: "owner_send_back",
    from: "owner_review",
    to: "consultant_pm",
    label: name("Send Back", "إرجاع"),
    kind: "send_back",
    outcome: null,
    permission: "approve",
  },
];
