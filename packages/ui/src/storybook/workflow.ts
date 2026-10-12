import { conditionOpKey, formSchema, ruleFieldsOf, workflowPublishProblems } from "@rabaed/domain";
import type {
  Locale,
  OutcomeAction,
  PositionOption,
  RuleField,
  TransitionKind,
  WorkflowDefinition,
  WorkflowProblem,
  WorkflowScreenOption,
  WorkflowStep,
  WorkflowTransition,
} from "@rabaed/domain";
import { ruleMessages } from "./workflow-rule-messages.ts";
import { builderMessages } from "./workflow-builder-messages.ts";
import { formatIcu, translator } from "./icu.ts";
import type { WorkflowRuleLabels } from "../components/workflow/workflow-rule-labels.ts";
import type { WorkflowBuilderOutcome } from "../components/workflow/workflow-builder.tsx";
import type { WorkflowBuilderLabels, WorkflowCompareLabels } from "../components/workflow/workflow-builder-labels.ts";
import { workflowBuilderLabels as labelsFromMessages } from "../components/workflow/workflow-builder-labels-from.ts";
import type { WorkflowLabels } from "../components/workflow/workflow-labels.ts";
import type { MapStage } from "../components/workflow/workflow-map.ts";

// The design's "Material Submittal – 2-tier review" (ui_kits/app/wf/data.js, and the owner's
// V2 builder's `script10.js`), for the Workflow canvas and builder stories. Story data only:
// it is not a visibility test.

const t = (en: string, ar: string) => ({ en, ar });

/** The same words in both languages: for tests, where only keys and shapes matter. */
export const sameInBoth = (text: string) => t(text, text);

export const workflowStages: MapStage[] = [
  // "Draft", singular: the owner's decision of 2026-10-10 (RP-409; migration draft_stage_singular).
  { key: "draft", name: t("Draft", "مسودة"), category: "draft" },
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
    step("consultant_manager", t("Consultant Manager decision", "قرار مدير الاستشاري"), "pending_approval", { role: "consultant", permission: "approve", positions: ["manager"] }, "issue_outcome"),
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

/** The canvas's words, as the web's messages give them. */
export function workflowLabels(locale: Locale): WorkflowLabels {
  return workflowBuilderLabels(locale).map;
}

// The builder (RP-439; RP-555's V2) ------------------------------------------------

const owner = step("owner_rep", t("Owner Representative approval", "اعتماد ممثل المالك"), "pending_approval", { role: "owner_representative", permission: "approve" });
const qa = step("consultant_qa", t("Consultant QA check", "تدقيق الجودة للاستشاري"), "pending_approval", { role: "consultant", permission: "review" });
const sendToOwner = (field: string): WorkflowTransition => ({
  ...move("send_to_owner", t("Send to Owner Rep", "إرسال لممثل المالك"), "submit", "consultant_manager", "owner_rep"),
  rules: { restrict: [{ type: "condition", condition: { field, op: ">", value: 500000 } }] },
  notifications: [{ to: "raiser" }],
});
/** The Screens each reply asks (ADR 0019, RP-555's picker). */
const screenOf: Record<string, string> = { return_to_engineer: "return_reason", approve_a: "code_reply", approve_b: "code_b_reply", revise_c: "code_reply", reject_d: "code_reply" };
const withScreens = (transitions: WorkflowTransition[]) => transitions.map((tr) => (screenOf[tr.key] ? { ...tr, screen: screenOf[tr.key]! } : tr));
const v3Transitions = [
  ...twoTierReview.transitions.slice(0, 9),
  sendToOwner("cost_impact"),
  move("owner_approve", t("Owner Approve", "اعتماد المالك"), "close", "owner_rep", "approved", "A"),
  move("owner_return", t("Owner Return", "إرجاع المالك"), "return", "owner_rep", "consultant_manager"),
  twoTierReview.transitions[9]!,
];
const v3Steps = [
  ...twoTierReview.steps.slice(0, 3),
  { ...twoTierReview.steps[3]!, actor: { role: "consultant" as const, permission: "approve" as const } },
  owner,
  ...twoTierReview.steps.slice(4),
];
/** Where the V2 reference draws each Step and End (left-to-right units). */
const v2Layout: WorkflowDefinition["layout"] = {
  draft: { x: 30, y: 250 },
  contractor_pm: { x: 280, y: 250 },
  consultant_engineer: { x: 530, y: 130 },
  consultant_manager: { x: 810, y: 130 },
  owner_rep: { x: 810, y: 420 },
  consultant_qa: { x: 530, y: 420 },
  approved: { x: 1110, y: 70 },
  revise: { x: 1110, y: 230 },
  rejected: { x: 1110, y: 380 },
  cancelled: { x: 1110, y: 540 },
};

/** The published v3: the two-tier review plus the Owner Representative's approval over 500,000 SAR. */
export const builderPublished: WorkflowDefinition = { steps: v3Steps, transitions: withScreens(v3Transitions), layout: v2Layout };

/**
 * The V2 reference's v4 draft (`script10.js`), seeded with its problems: the QA check has no way
 * forward, the Owner Rep's condition reads a field the Form lacks (`cost_impact_sar`), and two
 * Returns cross Participants. Its 6 Steps and 15 Transitions pair the stories with V2's states.
 */
export const builderDraft: WorkflowDefinition = {
  steps: [...v3Steps.slice(0, 5), qa, ...v3Steps.slice(5)],
  transitions: withScreens([
    ...v3Transitions.slice(0, 9),
    sendToOwner("cost_impact_sar"),
    ...v3Transitions.slice(10),
    move("send_to_qa", t("Send to QA", "إرسال للجودة"), "send", "consultant_engineer", "consultant_qa"),
    move("return_to_consultant", t("Return to Consultant", "إرجاع للاستشاري"), "return", "contractor_pm", "consultant_engineer"),
  ]),
  layout: v2Layout,
};

/** The draft with its condition on the Form's cost impact: the test run samples it (V2's run reads it whatever the field). */
export const builderDraftSampled: WorkflowDefinition = {
  ...builderDraft,
  transitions: builderDraft.transitions.map((tr) => (tr.key === "send_to_owner" ? sendToOwner("cost_impact") : tr)),
};

export const builderOutcomes: WorkflowBuilderOutcome[] = [
  { code: "A", name: t("Approved", "معتمد"), closing: true },
  { code: "B", name: t("Approved with Comments", "معتمد مع ملاحظات"), closing: true },
  { code: "C", name: t("Revise & Resubmit", "مراجعة وإعادة تقديم"), closing: true },
  { code: "D", name: t("Rejected", "مرفوض"), closing: true },
];

/** The outcomes as the publish checks read them: Code B creates the reviewer's Comments in the Snag List (WF-11). */
const checkedOutcomes = builderOutcomes.map((o) => ({ ...o, actions: (o.code === "B" ? [{ kind: "create_items", type: "CMT" }] : []) as OutcomeAction[] }));

export const builderPositions: PositionOption[] = [
  { role: "contractor", key: "engineer", name: t("Engineer", "مهندس") },
  { role: "contractor", key: "project_manager", name: t("Project Manager", "مدير المشروع") },
  { role: "consultant", key: "engineer", name: t("Engineer", "مهندس") },
  { role: "consultant", key: "manager", name: t("Manager", "مدير") },
  { role: "owner_representative", key: "engineer", name: t("Engineer", "مهندس") },
];

/**
 * The Type's Form, as WF-4's builder read gives it (the MAR's, in short): the raiser's
 * section, and the verification the Consultant fills at its Steps.
 */
export const builderForm = formSchema.parse({
  sections: [
    {
      key: "submittal",
      title: t("Submittal", "التقديم"),
      fields: [
        { key: "manufacturer", type: "text", label: t("Manufacturer", "الشركة المصنعة") },
        { key: "cost_impact", type: "currency", currency: "SAR", label: t("Cost impact", "أثر التكلفة") },
        {
          key: "category",
          type: "select",
          label: t("Category", "الفئة"),
          options: [
            { value: "civil", label: t("Civil", "مدني") },
            { value: "mep", label: t("MEP", "ميكانيكا وكهرباء") },
          ],
        },
        { key: "needed_by", type: "date", label: t("Needed by", "مطلوب قبل") },
        { key: "datasheet", type: "attachments", label: t("Datasheet", "الورقة الفنية") },
      ],
    },
    {
      key: "verification",
      title: t("Verification", "التحقق"),
      editable_at: ["consultant_engineer", "consultant_manager"],
      fields: [
        { key: "sample_checked", type: "yes_no", label: t("Sample checked", "تم فحص العينة") },
        { key: "verification_note", type: "textarea", label: t("Verification note", "ملاحظة التحقق") },
      ],
    },
  ],
});

/** The Form's fields a rule can name. */
export const builderFields: RuleField[] = ruleFieldsOf(builderForm, null);

/** The Screens the builder offers a Transition (RP-555's picker), as the builder read gives them. */
export const builderScreens: WorkflowScreenOption[] = [
  {
    key: "code_reply",
    name: t("Code reply", "الرد بالرمز"),
    schema: formSchema.parse({
      sections: [{ key: "reply", title: t("Reply", "الرد"), fields: [{ type: "textarea", key: "remarks", label: t("Remarks", "الملاحظات") }] }],
    }),
  },
  {
    key: "return_reason",
    name: t("Return with a reason", "إرجاع مع السبب"),
    schema: formSchema.parse({
      sections: [{ key: "return", title: t("Reason", "السبب"), fields: [{ type: "textarea", key: "reason", label: t("Reason", "السبب"), required: true }] }],
    }),
  },
  {
    // Code B's reply: its Comments, each a row, become Comments in the Snag List (WF-11; V2's follow-up tasks).
    key: "code_b_reply",
    name: t("Code B reply with Comments", "رد الرمز B مع الملاحظات"),
    schema: formSchema.parse({
      sections: [
        {
          key: "reply",
          title: t("Reply", "الرد"),
          fields: [
            { type: "textarea", key: "remarks", label: t("Remarks", "الملاحظات"), required: true },
            {
              type: "table",
              key: "items_to_create",
              label: t("Comments to close out", "ملاحظات للإغلاق"),
              required: true,
              columns: [
                { key: "subject", type: "text", label: t("What needs to be done", "المطلوب") },
                { key: "location", type: "text", label: t("Location", "الموقع") },
              ],
            },
          ],
        },
      ],
    }),
  },
];

const checkedScreens = new Map(builderScreens.map((s) => [s.key, { schema: s.schema, internalFields: [] }]));

/** The publish checks' problems for a draft, as WF-4's validate gives them, its Screens read as publishing reads them. */
export function builderProblemsOf(definition: WorkflowDefinition): WorkflowProblem[] {
  return workflowPublishProblems(definition, { outcomes: checkedOutcomes, stages: workflowStages, form: builderForm, screens: checkedScreens });
}

/** The V2 draft's problems. */
export const builderProblems: WorkflowProblem[] = builderProblemsOf(builderDraft);

/** The rules stories' Transition (RP-440): "Send to Owner Rep", with one rule of each group and a warning on it. */
export const rulesDraft: WorkflowDefinition = {
  ...builderDraft,
  transitions: builderDraft.transitions.map((tr) =>
    tr.key === "send_to_owner"
      ? {
          ...tr,
          rules: {
            restrict: [
              { type: "condition", condition: { field: "cost_impact", op: ">", value: 500000 } },
              { type: "positions", positions: ["manager"] },
            ],
            validate: [{ type: "condition", condition: { field: "verification_note", op: "not_empty" }, message: t("Add a verification note.", "أضف ملاحظة تحقق.") }],
          },
          actions: [{ type: "offer_assign_to" }],
          notifications: [{ to: "raiser" }],
        }
      : tr,
  ),
};

/** Problems as WF-4's validate gives them: an error on a Step, a warning on a Transition. */
export const rulesProblems: WorkflowProblem[] = [
  {
    code: "dead_end_step",
    severity: "error",
    step: "consultant_qa",
    message: t("Step “Consultant QA check” has no way forward.", "الخطوة «تدقيق الجودة للاستشاري» ليس لها مسار للأمام."),
  },
  {
    code: "condition_overlap",
    severity: "warning",
    transition: "send_to_owner",
    message: t("Two Transitions from the same Step can both be offered.", "انتقالان من نفس الخطوة قد يُعرضان معًا."),
  },
];

/** Items the author sees on each published Version (the publish dialog's counts). */
export const builderRunning = [
  { versionNo: 3, count: 31 },
  { versionNo: 2, count: 14 },
  { versionNo: 1, count: 2 },
];

type Messages = Record<string, unknown>;

/** `{name}` placeholders filled in, as the messages' ICU would. */
const fmt = (template: string, values: Record<string, string> = {}) => formatIcu(template, values, "en");

/** The rules' and notifications' words, as the web's messages give them. */
export function workflowRuleLabels(locale: Locale): WorkflowRuleLabels {
  const m: Messages = ruleMessages[locale];
  const text = (key: string) => m[key] as string;
  const nested = (key: string, name: string) => (m[key] as Record<string, string>)[name]!;
  return {
    heading: text("heading"),
    addRule: text("addRule"),
    noRules: text("noRules"),
    and: text("and"),
    edit: (summary) => fmt(text("edit"), { summary }),
    remove: (summary) => fmt(text("remove"), { summary }),
    tabsName: text("tabsName"),
    tabSettings: text("tabSettings"),
    tabNotifications: text("tabNotifications"),
    addTitle: (transition) => fmt(text("addTitle"), { transition }),
    editTitle: (transition) => fmt(text("editTitle"), { transition }),
    chooseKind: text("chooseKind"),
    next: text("next"),
    back: text("back"),
    add: text("add"),
    save: text("save"),
    cancel: text("cancel"),
    close: text("close"),
    groupTitle: (g) => nested("groupTitle", g),
    groupHelp: (g) => nested("groupHelp", g),
    kindTitle: (k) => nested("kindTitle", k),
    kindHelp: (k) => nested("kindHelp", k),
    noFields: text("noFields"),
    field: text("field"),
    operator: text("operator"),
    value: text("value"),
    yes: text("yes"),
    no: text("no"),
    op: (o) => nested("op", conditionOpKey[o]),
    missingField: (key) => fmt(text("missingField"), { key }),
    positions: text("positions"),
    positionsHelp: text("positionsHelp"),
    noPositions: text("noPositions"),
    notSamePersonOf: text("notSamePersonOf"),
    heldStep: text("heldStep"),
    tookTransition: text("tookTransition"),
    step: text("step"),
    transition: text("transition"),
    beenThroughOf: text("beenThroughOf"),
    ownStep: text("ownStep"),
    fact: text("fact"),
    sharedFact: (f) => nested("sharedFact", f),
    items: text("items"),
    itemsKind: (i) => nested("itemsKind", i),
    messageHeading: text("messageHeading"),
    messageEn: text("messageEn"),
    messageAr: text("messageAr"),
    messageHelp: text("messageHelp"),
    documentField: text("documentField"),
    anyDocument: text("anyDocument"),
    documentHelp: text("documentHelp"),
    setValue: text("setValue"),
    setNow: text("setNow"),
    copyFrom: text("copyFrom"),
    copyTo: text("copyTo"),
    assignHelp: text("assignHelp"),
    conditionKind: text("conditionKind"),
    conditionKindName: (k) => nested("conditionKindName", k),
    conditionKindHelp: (k) => nested("conditionKindHelp", k),
    editCondition: text("editCondition"),
    addCondition: text("addCondition"),
    addGroup: text("addGroup"),
    removeCondition: text("removeCondition"),
    emptyGroup: text("emptyGroup"),
    attribute: (name) => fmt(text("attribute"), { name }),
    summaryCondition: (field, op, value) => fmt(text("summaryCondition"), { field, op, value }),
    summaryAll: (parts) => fmt(text("summaryAll"), { parts }),
    summaryAny: (parts) => fmt(text("summaryAny"), { parts }),
    summaryNot: (part) => fmt(text("summaryNot"), { part }),
    summaryPositions: (names) => fmt(text("summaryPositions"), { names }),
    summaryNotSameStep: (step) => fmt(text("summaryNotSameStep"), { step }),
    summaryNotSameTransition: (transition) => fmt(text("summaryNotSameTransition"), { transition }),
    summaryBeenStep: (step) => fmt(text("summaryBeenStep"), { step }),
    summaryFact: (f) => nested("summaryFact", f),
    summaryAllClosed: (i) => nested("summaryAllClosed", i),
    summaryDocument: (field) => (field === null ? text("summaryDocumentAny") : fmt(text("summaryDocument"), { field })),
    summaryMessage: (message) => fmt(text("summaryMessage"), { message }),
    summarySet: (field, value) => fmt(text("summarySet"), { field, value }),
    summarySetNow: (field) => fmt(text("summarySetNow"), { field }),
    summaryCopy: (from, to) => fmt(text("summaryCopy"), { from, to }),
    notificationsHeading: text("notificationsHeading"),
    notificationsHelp: text("notificationsHelp"),
    recipients: text("recipients"),
    holder: text("holder"),
    holderAlways: text("holderAlways"),
    raiser: text("raiser"),
    watchers: text("watchers"),
    positionsOfActing: text("positionsOfActing"),
    noActingPositions: text("noActingPositions"),
    channels: text("channels"),
    inApp: text("inApp"),
    inAppHelp: text("inAppHelp"),
    email: text("email"),
    emailHelp: text("emailHelp"),
    sms: text("sms"),
    smsHelp: text("smsHelp"),
  };
}

/** The builder's words, from the web's own messages, as the Project settings page builds them. */
export function workflowBuilderLabels(locale: Locale): WorkflowBuilderLabels {
  const m = builderMessages[locale];
  const tr = (tree: unknown) => translator(tree as Record<string, string>, locale);
  const t = tr(m.workflowBuilder);
  const name = (key: keyof typeof m.workflowBuilder.names) => ({ en: builderMessages.en.workflowBuilder.names[key], ar: builderMessages.ar.workflowBuilder.names[key] });
  const labels = labelsFromMessages({
    t,
    tMap: tr(m.workflowMap),
    tRules: (key) => key,
    tRoles: tr(m.roles),
    positions: builderPositions,
    locale,
    names: {
      firstStep: name("firstStep"),
      newStep: name("newStep"),
      newTransition: name("newTransition"),
      engineerReview: name("engineerReview"),
      pmReview: name("pmReview"),
      consultantEngineer: name("consultantEngineer"),
      consultantManager: name("consultantManager"),
      send: name("send"),
      submit: name("submit"),
      return: name("return"),
      cancel: name("cancel"),
    },
  });
  return { ...labels, rules: workflowRuleLabels(locale) };
}

/** The compare dialog's words. */
export function workflowCompareLabels(locale: Locale): WorkflowCompareLabels {
  const ar = locale === "ar";
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  return {
    map: workflowLabels(locale),
    title: (from, to) => l(`Compare v${from} → v${to}`, `مقارنة v${from} ← v${to}`),
    version: (v) => `v${v}`,
    legendAdded: l("added", "مضاف"),
    legendRemoved: l("removed", "محذوف"),
    legendChanged: l("changed", "متغيّر"),
    added: l("Added", "أُضيف"),
    removed: l("Removed", "أُزيل"),
    changed: l("Changed", "تغيّر"),
    noChanges: l("No changes", "لا تغييرات"),
    close: l("Close", "إغلاق"),
  };
}
