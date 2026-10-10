import { conditionOpKey, formSchema, ruleFieldsOf } from "@rabaed/domain";
import type { BaseRole, FunctionPermission, Locale, PositionOption, RuleField, TransitionKind, WorkflowDefinition, WorkflowProblem, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import { ruleMessages } from "./workflow-rule-messages.ts";
import type { WorkflowRuleLabels } from "../components/workflow/workflow-rule-labels.ts";
import type { WorkflowBuilderOutcome } from "../components/workflow/workflow-builder.tsx";
import type { WorkflowBuilderLabels, WorkflowCompareLabels } from "../components/workflow/workflow-builder-labels.ts";
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
    position: (key) => (key === "manager" ? (ar ? "المدير" : "Manager") : key),
    part: (role) => (ar ? `مراجعة ${role}` : `${role} review`),
    withCompany: (company) => (ar ? `لدى ${company}` : `With ${company}`),
    current: ar ? "الحالية" : "Current",
    to: ar ? "إلى" : "to",
    overview: ar ? "نظرة عامة" : "Overview",
    zoomIn: ar ? "تكبير" : "Zoom in",
    zoomOut: ar ? "تصغير" : "Zoom out",
    fit: ar ? "ملاءمة" : "Fit",
  };
}

// The builder (RP-439) ------------------------------------------------------------

/** The design's v4 draft: the two-tier review plus an Owner Representative approval, with the Code A reply's Screen. */
export const builderDraft: WorkflowDefinition = {
  ...twoTierReview,
  steps: [
    ...twoTierReview.steps.slice(0, 4),
    step("owner_rep", t("Owner Representative approval", "اعتماد ممثل المالك"), "pending_approval", { role: "owner_representative", permission: "approve" }, "issue_outcome"),
    ...twoTierReview.steps.slice(4),
  ],
  transitions: [
    ...twoTierReview.transitions.map((tr) =>
      tr.key === "approve_a"
        ? {
            ...tr,
            actionForm: {
              sections: [
                {
                  key: "reply",
                  title: t("Reply", "الرد"),
                  fields: [
                    { type: "textarea", key: "remarks", label: t("Remarks", "الملاحظات"), required: false },
                    { type: "checkbox", key: "final_verification", label: t("Final verification", "التحقق النهائي"), required: true },
                  ],
                },
              ],
            },
          }
        : tr,
    ),
    {
      ...move("send_to_owner", t("Send to Owner Rep", "إرسال لممثل المالك"), "submit", "consultant_manager", "owner_rep"),
      // The rules the design's Condition shows (cost impact over 500,000), and one of each of the other groups.
      rules: {
        restrict: [
          { type: "condition", condition: { field: "cost_impact", op: ">", value: 500000 } },
          { type: "positions", positions: ["manager"] },
        ],
        validate: [{ type: "condition", condition: { field: "verification_note", op: "not_empty" }, message: t("Add a verification note.", "أضف ملاحظة تحقق.") }],
      },
      actions: [{ type: "offer_assign_to" }],
      notifications: [{ to: "raiser" }],
    },
    move("owner_approve", t("Owner Approve", "اعتماد المالك"), "close", "owner_rep", "approved", "A"),
  ],
};

export const builderOutcomes: WorkflowBuilderOutcome[] = [
  { code: "A", name: t("Approved", "معتمد"), closing: true },
  { code: "B", name: t("Approved with Comments", "معتمد مع ملاحظات"), closing: true },
  { code: "C", name: t("Revise & Resubmit", "مراجعة وإعادة تقديم"), closing: true },
  { code: "D", name: t("Rejected", "مرفوض"), closing: true },
];

export const builderPositions: PositionOption[] = [
  { role: "contractor", key: "engineer", name: t("Engineer", "مهندس") },
  { role: "contractor", key: "project_manager", name: t("Project Manager", "مدير المشروع") },
  { role: "consultant", key: "engineer", name: t("Engineer", "مهندس") },
  { role: "consultant", key: "manager", name: t("Manager", "مدير") },
  { role: "owner_representative", key: "engineer", name: t("Engineer", "مهندس") },
];

/** Problems as WF-4's validate gives them: an error on a Step, a warning on a Transition. */
export const builderProblems: WorkflowProblem[] = [
  {
    code: "dead_end_step",
    severity: "error",
    step: "owner_rep",
    message: t("Step “Owner Representative approval” has no way forward.", "الخطوة «اعتماد ممثل المالك» ليس لها مسار للأمام."),
  },
  {
    code: "condition_overlap",
    severity: "warning",
    transition: "send_to_owner",
    message: t("Two Transitions from the same Step can both be offered.", "انتقالان من نفس الخطوة قد يُعرضان معًا."),
  },
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
        { key: "cost_impact", type: "number", label: t("Cost impact (SAR)", "أثر التكلفة (ريال)") },
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

type Messages = Record<string, unknown>;

/** `{name}` placeholders filled in, as the messages' ICU would. */
const fmt = (template: string, values: Record<string, string> = {}) => template.replaceAll(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");

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

/** The builder's words, as the web's messages give them. */
export function workflowBuilderLabels(locale: Locale): WorkflowBuilderLabels {
  const ar = locale === "ar";
  const l = (en: string, arabic: string) => (ar ? arabic : en);
  return {
    map: workflowLabels(locale),
    rules: workflowRuleLabels(locale),
    back: l("Workflows", "سير العمل"),
    draft: (v) => l(`Draft v${v}`, `مسودة v${v}`),
    saved: (time) => l(`Saved ${time}`, `حُفظت ${time}`),
    saving: l("Saving…", "جارٍ الحفظ…"),
    unsaved: l("Unsaved changes", "تغييرات غير محفوظة"),
    saveFailed: l("Couldn't save", "تعذّر الحفظ"),
    undo: l("Undo", "تراجع"),
    redo: l("Redo", "إعادة"),
    autoLayout: l("Auto-arrange", "ترتيب تلقائي"),
    testRun: l("Test run", "تشغيل تجريبي"),
    validate: l("Validate", "تحقق"),
    publish: l("Publish", "نشر"),
    palette: l("Add to the Workflow", "الإضافة إلى سير العمل"),
    add: l("Add", "إضافة"),
    step: l("Step", "خطوة"),
    end: (stage) => l(`End · ${stage}`, `نهاية · ${stage}`),
    templates: l("Ready-made Steps", "خطوات جاهزة"),
    templateInternal: l("2-tier internal review", "مراجعة داخلية على مستويين"),
    templateConsultant: l("Consultant engineer → manager", "مهندس الاستشاري ← المدير"),
    editor: l("Edit the selection", "تعديل التحديد"),
    nothingSelected: l("Nothing selected", "لا يوجد تحديد"),
    nothingSelectedHint: l("Click a Step or an arrow to edit it. Drag Steps to move them.", "انقر على خطوة أو سهم لتعديله. اسحب الخطوات لنقلها."),
    thisDraft: l("This draft", "هذه المسودة"),
    counts: (s, tr) => l(`${s} Steps · ${tr} Transitions`, `${s} خطوات · ${tr} انتقالات`),
    stepHeading: l("Step", "خطوة"),
    nameEn: l("Name (English)", "الاسم (بالإنجليزية)"),
    nameAr: l("Name (Arabic)", "الاسم (بالعربية)"),
    stage: l("Stage", "المرحلة"),
    whoHolds: l("Who holds it", "من يتولاها"),
    role: l("Participant", "المشارك"),
    permission: l("Permission", "الصلاحية"),
    positions: l("Positions", "المناصب"),
    positionsHelp: l("None ticked: anyone of that Participant with the Permission.", "بدون تحديد: أي شخص من ذلك المشارك لديه الصلاحية."),
    outcomeHeading: l("Outcome", "النتيجة"),
    outcomeNone: l("None", "بدون"),
    draftsVisibleTo: l("Drafts visible to", "المسودات مرئية لـ"),
    draftsWholeCompany: l("The author's whole Company", "شركة المُنشئ كاملة"),
    draftsAuthorOnly: l("The author only", "المُنشئ فقط"),
    draftsVisibleHelp: l("A Draft is read by the author's whole Company.", "تُقرأ المسودة من شركة المُنشئ كاملة."),
    addTransitionTo: l("Add a Transition to", "إضافة انتقال إلى"),
    addTransitionHelp: l("Or drag from this Step's edge to another Step.", "أو اسحب من حافة هذه الخطوة إلى خطوة أخرى."),
    deleteStep: l("Delete Step", "حذف الخطوة"),
    endHeading: l("End", "نهاية"),
    transitionHeading: (from, to) => l(`Transition · ${from} → ${to}`, `انتقال · ${from} ← ${to}`),
    labelEn: l("Label (English)", "النص (بالإنجليزية)"),
    labelAr: l("Label (Arabic)", "النص (بالعربية)"),
    kind: l("Type", "النوع"),
    outcomeCode: l("Outcome", "النتيجة"),
    noOutcome: "—",
    outcomeOnlyOnClose: l("Only a Close sets an outcome.", "لا يحدد النتيجة إلا انتقال من نوع إغلاق."),
    screen: l("Screen", "الشاشة"),
    screenHelp: l("The Screen this Transition asks. Screens are edited in Settings → Screens.", "الشاشة التي يطلبها هذا الانتقال. تُعدَّل الشاشات في الإعدادات ← الشاشات."),
    internalNoteOnly: l("Internal Note only", "ملاحظة داخلية فقط"),
    confirm: l("Confirm", "تأكيد"),
    deleteTransition: l("Delete Transition", "حذف الانتقال"),
    problemsName: l("Validation", "التحقق"),
    noErrors: l("No errors", "لا أخطاء"),
    errors: (n) => l(`${n} errors`, `${n} أخطاء`),
    warnings: (n) => l(`${n} warnings`, `${n} تحذيرات`),
    showProblem: (m) => l(`Show: ${m}`, `عرض: ${m}`),
    validationPassed: l("Validation passed", "اجتاز التحقق"),
    errorsToFix: (n) => l(`${n} errors to fix`, `${n} أخطاء للإصلاح`),
    testRunAt: l("At", "عند"),
    finished: (o) => l(`Finished: ${o}`, `انتهى: ${o}`),
    restart: l("Restart", "إعادة"),
    closeTestRun: l("Close the test run", "إغلاق التشغيل التجريبي"),
    publishTitle: (v) => l(`Publish v${v}`, `نشر v${v}`),
    changesSince: (v) => l(`Changes since v${v}`, `التغييرات منذ v${v}`),
    firstVersion: l("The first Version of this Workflow", "أول إصدار لسير العمل هذا"),
    added: l("Added", "أُضيف"),
    removed: l("Removed", "أُزيل"),
    changed: l("Changed", "تغيّر"),
    noChanges: l("No changes", "لا تغييرات"),
    checking: l("Checking on the server…", "جارٍ التحقق على الخادم…"),
    passed: l("Validation passed", "اجتاز التحقق"),
    errorsBlock: (n) => l(`${n} validation errors — fix them before publishing.`, `${n} أخطاء تحقق — أصلحها قبل النشر.`),
    showProblems: l("Show problems", "عرض المشكلات"),
    appliesToNew: (v) => l(`Items already running keep their Version. New items will use v${v}.`, `العناصر الجارية تحتفظ بإصداراتها. العناصر الجديدة ستستخدم v${v}.`),
    cancel: l("Cancel", "إلغاء"),
    publishVersion: (v) => l(`Publish v${v}`, `نشر v${v}`),
    published: (v) => l(`v${v} published — new items will use it`, `تم نشر v${v} — العناصر الجديدة ستستخدمه`),
    close: l("Close", "إغلاق"),
    alertsRegion: l("Builder alerts", "تنبيهات المصمم"),
    dismiss: l("Dismiss", "إخفاء"),
    names: {
      newStep: t("New step", "خطوة جديدة"),
      newTransition: t("New transition", "انتقال جديد"),
      engineerReview: t("Engineer review", "مراجعة المهندس"),
      pmReview: t("PM review", "مراجعة المدير"),
      consultantEngineer: t("Consultant engineer", "مهندس الاستشاري"),
      consultantManager: t("Consultant manager", "مدير الاستشاري"),
      send: t("Send", "إرسال"),
      return: t("Return", "إرجاع"),
    },
  };
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
