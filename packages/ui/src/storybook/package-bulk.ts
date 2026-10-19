import type { Locale } from "@rabaed/domain";
import type { PackageBulkLabels } from "../components/packages/package-bulk.tsx";

// Bulk Transitions' words for stories (RP-661), as the web's messages (packages.bulk) say them.
// Arabic counts one, two (dual), 3 to 10 (plural) and 11 and more (singular accusative).

const arabicSubmittals = (n: string, count: number) =>
  count === 1 ? "اعتماد واحد" : count === 2 ? "اعتمادين" : count <= 10 ? `${n} اعتمادات` : `${n} اعتمادًا`;

export const packageBulkLabels: Record<Locale, PackageBulkLabels> = {
  en: {
    bar: "Take a Transition on the selected submittals",
    hint: "Select the submittals waiting on you to take one Transition on them all.",
    selected: (n) => `${n} selected`,
    transitions: "Transitions they share",
    noneShared: "These don't share a Transition. Select ones at the same Step.",
    clear: "Clear",
    selectAll: "Select all waiting on you",
    selectRow: (subject) => `Select ${subject}`,
    description: (n, count) =>
      `Taken on ${count === 1 ? "1 submittal" : `${n} submittals`} with the same answers, each signed as on its own. All or nothing: if one can't take it, none moves.`,
    appliesTo: "Taken on",
    noNumber: "No number yet",
    loading: "Loading…",
    assignTo: "Assign to",
    assignToHelp: "Who in your Company takes the next step on all of them. Leave it to the Step Pool and anyone who may take it can pick them up.",
    assignToPool: "Step Pool: anyone who may take it",
    formInvalid: "Fill in the marked fields first.",
    stoppedTitle: "Nothing was done",
    stoppedBy: "This submittal stopped it, so none of them moved:",
    reasons: {
      not_waiting: "It no longer waits on you.",
      transition_not_offered: "It doesn't offer you this Transition now. Pick it up first, or it is at another Step.",
      different_action_form: "Its Transition asks for a different Action Form. Take it on its own.",
      form_incomplete: "Its Form has a required field to fill.",
      invalid_action_form: "The answers don't suit it. Check the marked fields.",
      validation_failed: "A rule of its Workflow isn't met.",
      assignee_not_offered: "The Member you chose can't take its next step. Choose someone from the list.",
      refused: "Its Transition was refused. Open it to see why.",
      no_signature: "You have no saved Signature yet. Add one in your profile: each submittal is signed as on its own.",
      unknown: "It can't take this Transition now. Open it to see why.",
    },
    refusals: {
      unavailable: "Something went wrong. Try again.",
      not_found: "One of them is no longer yours to act on. The page shows what is true now.",
      idempotency_key_reused: "The selection changed meanwhile. Close this and try again.",
      not_confirmed: "The answers changed meanwhile. Try again.",
    },
  },
  ar: {
    bar: "تنفيذ انتقال على الاعتمادات المحددة",
    hint: "حدّد الاعتمادات التي تنتظرك لتنفّذ انتقالًا واحدًا عليها جميعًا.",
    selected: (n) => `${n} محدد`,
    transitions: "الانتقالات المشتركة بينها",
    noneShared: "لا تشترك هذه في انتقال واحد. حدّد اعتمادات في الخطوة نفسها.",
    clear: "مسح",
    selectAll: "تحديد كل ما ينتظرك",
    selectRow: (subject) => `تحديد ${subject}`,
    description: (n, count) =>
      `يُنفَّذ على ${arabicSubmittals(n, count)} بالإجابات نفسها، ويُوقَّع كلٌّ منها كما لو نُفِّذ وحده. الكل أو لا شيء: إن تعذّر أحدها فلا ينتقل أي منها.`,
    appliesTo: "يُنفَّذ على",
    noNumber: "لا رقم بعد",
    loading: "جارٍ التحميل…",
    assignTo: "إسناد إلى",
    assignToHelp: "من في شركتك يتولى الخطوة التالية عليها جميعًا. اتركها لمجموعة الخطوة ليستلمها أي شخص يحق له ذلك.",
    assignToPool: "مجموعة الخطوة: أي شخص يحق له تنفيذها",
    formInvalid: "املأ الحقول المحددة أولًا.",
    stoppedTitle: "لم يُنفَّذ شيء",
    stoppedBy: "أوقف هذا الاعتماد التنفيذ، فلم ينتقل أي منها:",
    reasons: {
      not_waiting: "لم يعد ينتظرك.",
      transition_not_offered: "لا يتيح لك هذا الانتقال الآن. استلمه أولًا، أو إنه في خطوة أخرى.",
      different_action_form: "انتقاله يطلب نموذج إجراء مختلفًا. نفّذه وحده.",
      form_incomplete: "في نموذجه حقل مطلوب لم يُملأ.",
      invalid_action_form: "الإجابات لا تناسبه. راجع الحقول المحددة.",
      validation_failed: "قاعدة من قواعد سير عمله غير مستوفاة.",
      assignee_not_offered: "العضو الذي اخترته لا يمكنه تولي خطوته التالية. اختر من القائمة.",
      refused: "رُفض انتقاله. افتحه لترى السبب.",
      no_signature: "ليس لديك توقيع محفوظ بعد. أضفه في ملفك الشخصي: يُوقَّع كل اعتماد كما لو نُفِّذ وحده.",
      unknown: "لا يمكنه تنفيذ هذا الانتقال الآن. افتحه لترى السبب.",
    },
    refusals: {
      unavailable: "حدث خطأ. حاول مرة أخرى.",
      not_found: "أحدها لم يعد مما يمكنك التصرف فيه. تعرض الصفحة الحال الآن.",
      idempotency_key_reused: "تغيّر التحديد في الأثناء. أغلق هذا وحاول مرة أخرى.",
      not_confirmed: "تغيّرت الإجابات في الأثناء. حاول مرة أخرى.",
    },
  },
};
