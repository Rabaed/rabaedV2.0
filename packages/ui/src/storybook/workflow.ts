import type { BaseRole, FunctionPermission, Locale, TransitionKind, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import type { WorkflowLabels } from "../components/workflow/workflow-labels.ts";
import type { MapStage } from "../components/workflow/workflow-map.ts";

// The design's "Material Submittal – 2-tier review" (ui_kits/app/wf/data.js), for the
// Workflow canvas stories. Story data only: it is not a visibility test.

const t = (en: string, ar: string) => ({ en, ar });

/** The same words in both languages: for tests, where only keys and shapes matter. */
export const sameInBoth = (text: string) => t(text, text);

export const workflowStages: MapStage[] = [
  { key: "draft", name: t("Drafts", "المسودات"), category: "draft" },
  { key: "internal_review", name: t("Internal Review", "مراجعة داخلية"), category: "in_progress" },
  { key: "pending_approval", name: t("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" },
  { key: "approved", name: t("Approved", "معتمد"), category: "closed_positive" },
  { key: "revise_resubmit", name: t("Revise & Resubmit", "مراجعة وإعادة تقديم"), category: "closed_negative" },
  { key: "rejected", name: t("Rejected", "مرفوض"), category: "closed_negative" },
  { key: "cancelled", name: t("Cancelled", "ملغى"), category: "cancelled" },
];

const step = (key: string, name: { en: string; ar: string }, stage: string, actor: WorkflowStep["actor"], outcomeMode: WorkflowStep["outcomeMode"] = "none"): WorkflowStep => ({
  key,
  name,
  stage,
  actor,
  outcomeMode,
});
const move = (key: string, label: { en: string; ar: string }, kind: TransitionKind, from: string, to: string, outcome: string | null = null): WorkflowTransition => ({
  key,
  label,
  kind,
  from,
  to,
  outcome,
  permission: kind === "close" ? "approve" : "review",
  actionForm: null,
});

export const twoTierReview: WorkflowDefinition = {
  steps: [
    step("draft", t("Contractor Engineer", "مهندس المقاول"), "draft", { role: "contractor", permission: "create" }),
    step("contractor_pm", t("Contractor PM review", "مراجعة مدير مشروع المقاول"), "internal_review", { role: "contractor", permission: "review" }),
    step("consultant_engineer", t("Consultant Engineer review", "مراجعة مهندس الاستشاري"), "pending_approval", { role: "consultant", permission: "review" }, "recommend_code"),
    step("consultant_manager", t("Consultant Manager decision", "قرار مدير الاستشاري"), "pending_approval", { role: "consultant", permission: "approve" }, "issue_outcome"),
    step("approved", t("Approved", "معتمد"), "approved", null),
    step("revise", t("Revise & Resubmit", "مراجعة وإعادة تقديم"), "revise_resubmit", null),
    step("rejected", t("Rejected", "مرفوض"), "rejected", null),
    step("cancelled", t("Cancelled", "ملغى"), "cancelled", null),
  ],
  transitions: [
    move("send_for_review", t("Send for Review", "إرسال للمراجعة"), "send", "draft", "contractor_pm"),
    move("return", t("Return", "إرجاع"), "return", "contractor_pm", "draft"),
    move("submit", t("Submit", "تقديم"), "submit", "contractor_pm", "consultant_engineer"),
    move("send_to_manager", t("Send to Manager", "إرسال للمدير"), "send", "consultant_engineer", "consultant_manager"),
    move("return_to_engineer", t("Return to Engineer", "إرجاع للمهندس"), "return", "consultant_manager", "consultant_engineer"),
    move("approve_a", t("Approve – Code A", "اعتماد – Code A"), "close", "consultant_manager", "approved", "A"),
    move("approve_b", t("Approve with Comments – Code B", "اعتماد مع ملاحظات – Code B"), "close", "consultant_manager", "approved", "B"),
    move("revise_c", t("Revise & Resubmit – Code C", "مراجعة وإعادة تقديم – Code C"), "close", "consultant_manager", "revise", "C"),
    move("reject_d", t("Reject – Code D", "رفض – Code D"), "close", "consultant_manager", "rejected", "D"),
    move("cancel", t("Cancel", "إلغاء"), "cancel", "draft", "cancelled"),
  ],
  layout: {},
};

export const consultantCompany = t("Design Consultants LLC", "ديزاين للاستشارات");

const roles: Record<BaseRole, { en: string; ar: string }> = {
  contractor: t("Contractor", "المقاول"),
  consultant: t("Consultant", "الاستشاري"),
  owner: t("Owner", "المالك"),
  owner_representative: t("Owner Representative", "ممثل المالك"),
};
const permissions: Record<FunctionPermission, { en: string; ar: string }> = {
  view: t("View", "عرض"),
  create: t("Create", "إنشاء"),
  submit: t("Submit", "تقديم"),
  review: t("Review", "مراجعة"),
  approve: t("Approve", "اعتماد"),
  assign: t("Assign", "تعيين"),
  close: t("Close", "إغلاق"),
  attach: t("Attach", "إرفاق"),
};
const kinds: Record<TransitionKind, { en: string; ar: string }> = {
  send: t("Send", "إرسال"),
  submit: t("Submit", "تقديم"),
  return: t("Return", "إرجاع"),
  send_back: t("Send Back", "إعادة للمُقدِّم"),
  close: t("Close", "إغلاق"),
  cancel: t("Cancel", "إلغاء"),
};

/** The canvas's words, as the web's messages give them. */
export function workflowLabels(locale: Locale): WorkflowLabels {
  const ar = locale === "ar";
  return {
    canvas: ar ? "خريطة سير العمل" : "Workflow map",
    list: ar ? "الخطوات والانتقالات" : "Steps and Transitions",
    outcome: ar ? "النتيجة" : "Outcome",
    role: (r) => roles[r][locale],
    permission: (p) => permissions[p][locale],
    outcomeMode: (m) => (m === "recommend_code" ? (ar ? "يوصي بالرمز" : "Recommends code") : ar ? "يصدر الرمز النهائي" : "Issues final code"),
    kind: (k) => kinds[k][locale],
    part: (role) => (ar ? `مراجعة ${role}` : `${role} review`),
    withCompany: (company) => (ar ? `لدى ${company}` : `With ${company}`),
    current: ar ? "الحالية" : "Current",
    to: ar ? "إلى" : "to",
    zoomIn: ar ? "تكبير" : "Zoom in",
    zoomOut: ar ? "تصغير" : "Zoom out",
    fit: ar ? "ملاءمة" : "Fit",
  };
}
