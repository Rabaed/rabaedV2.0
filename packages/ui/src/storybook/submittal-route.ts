import type { TransitionKind, WorkItemMapPosition, WorkItemWorkflowMap, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import { workflowStages } from "./workflow.ts";

// The Rabaed Default "Submittal 2→2 with the Owner's review" (apps/admin/workflows/submittal-2-2-owner.json),
// for the route strip's and Workflow map's tests and stories (RP-1064). Story data only: it is not a
// visibility test; the API decides what the viewer may know (`position`).

const t = (en: string, ar: string) => ({ en, ar });

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

const recommend = (code: string, en: string, ar: string) => move(`recommend_${code.toLowerCase()}`, t(`Recommend ${en} · ${code}`, `التوصية بـ${ar} · ${code}`), "submit", "consultant_manager", "owner_review", code);
const confirm = (code: string, to: string) => move(`confirm_${code.toLowerCase()}`, t("Confirm", "تأكيد"), "close", "owner_review", to, code);

export const submittalOwnerWorkflow: WorkflowDefinition = {
  steps: [
    step("draft", t("Draft", "مسودة"), "draft", { role: "contractor", permission: "create" }),
    step("internal_review", t("Contractor PM", "مدير مشروع المقاول"), "internal_review", { role: "contractor", permission: "review" }),
    step("contractor_engineer", t("Contractor Engineer", "مهندس المقاول"), "internal_review", { role: "contractor", permission: "create" }),
    step("consultant_engineer", t("Consultant Engineer", "مهندس الاستشاري"), "pending_approval", { role: "consultant", permission: "review" }, "recommend_code"),
    step("consultant_manager", t("Consultant Manager", "مدير الاستشاري"), "pending_approval", { role: "consultant", permission: "approve" }, "recommend_code"),
    step("owner_review", t("Owner review", "مراجعة المالك"), "pending_approval", { role: "owner", permission: "approve" }, "confirm_code"),
    step("approved", t("Approved", "معتمد"), "approved", null),
    step("revise_resubmit", t("Revise & Resubmit", "مراجعة وإعادة تقديم"), "revise_resubmit", null),
    step("rejected", t("Rejected", "مرفوض"), "rejected", null),
    step("cancelled", t("Cancelled", "ملغى"), "cancelled", null),
  ],
  transitions: [
    move("send_for_review", t("Send for Review", "إرسال للمراجعة"), "send", "draft", "internal_review"),
    move("return", t("Return", "إعادة"), "return", "internal_review", "contractor_engineer"),
    move("resend", t("Send for Review", "إرسال للمراجعة"), "send", "contractor_engineer", "internal_review"),
    move("submit", t("Submit", "تقديم"), "submit", "internal_review", "consultant_engineer"),
    move("send_to_manager", t("Send to Manager", "إرسال للمدير"), "send", "consultant_engineer", "consultant_manager"),
    move("return_to_engineer", t("Return to Engineer", "إعادة للمهندس"), "return", "consultant_manager", "consultant_engineer"),
    recommend("A", "Approve", "اعتماد"),
    recommend("B", "Approve with Comments", "اعتماد مع ملاحظات"),
    recommend("C", "Revise & Resubmit", "مراجعة وإعادة تقديم"),
    recommend("D", "Reject", "رفض"),
    confirm("A", "approved"),
    confirm("B", "approved"),
    confirm("C", "revise_resubmit"),
    confirm("D", "rejected"),
    move("owner_send_back", t("Send Back", "إرجاع"), "send_back", "owner_review", "consultant_manager"),
    move("cancel", t("Cancel", "إلغاء"), "cancel", "draft", "cancelled"),
    move("cancel_engineer", t("Cancel", "إلغاء"), "cancel", "contractor_engineer", "cancelled"),
    move("cancel_review", t("Cancel", "إلغاء"), "cancel", "internal_review", "cancelled"),
  ],
  layout: {},
};

/** The item's map as `GET /v1/work-items/:id/workflow` gives it, where the item is as `position` says. */
export function submittalOwnerMap(position: WorkItemMapPosition | null, viewerRole: WorkItemWorkflowMap["viewerRole"] = "contractor"): WorkItemWorkflowMap {
  return {
    name: t("Document Approval Request, 2→2 with Owner review", "طلب اعتماد مستند، 2←2 مع مراجعة المالك"),
    versionNo: 3,
    latestVersionNo: 3,
    definition: submittalOwnerWorkflow,
    stages: workflowStages,
    positions: [],
    viewerRole,
    position,
  };
}
