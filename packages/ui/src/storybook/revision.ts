import type { Locale } from "@rabaed/domain";
import type { RevisionActionsLabels } from "../components/revision/revision-actions.tsx";
import type { RevisionPickerLabels } from "../components/revision/revision-picker.tsx";

// Story copy for the Revision components: the labels the app passes from its
// messages (apps/web/messages), in English and Arabic.

export const revisionActionsLabels: Record<Locale, RevisionActionsLabels> = {
  en: {
    section: "Revision",
    createIntro: "Create a Revision of this item under the same number: it starts as a Draft with your answers and Documents.",
    create: "Create Revision",
    discard: "Discard Revision",
    discardTitle: "Discard this Revision?",
    discardIntro: "It is still a Draft, so nobody outside your company has seen it. The next Revision you create takes its Rev number.",
    cancel: "Cancel",
    close: "Close",
    refusals: {
      revision_not_allowed: "A Revision can't be created from this item now. Reload the page to see why.",
      not_discardable: "This Revision has left Draft, so it can no longer be discarded.",
      project_closed: "The Project is closed.",
      not_found: "This item is no longer available to you.",
      idempotency_key_reused: "That didn't work. Try again.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    section: "المراجعة",
    createIntro: "أنشئ مراجعة لهذا البند بالرقم نفسه: تبدأ مسودةً فيها إجاباتك ومستنداتك.",
    create: "إنشاء مراجعة",
    discard: "حذف مسودة المراجعة",
    discardTitle: "حذف مسودة هذه المراجعة؟",
    discardIntro: "ما زالت مسودة، فلم يطّلع عليها أحد خارج شركتك. تأخذ المراجعة التالية التي تنشئها رقمها.",
    cancel: "إلغاء",
    close: "إغلاق",
    refusals: {
      revision_not_allowed: "لا يمكن إنشاء مراجعة من هذا البند الآن. أعد تحميل الصفحة لمعرفة السبب.",
      not_discardable: "غادرت هذه المراجعة مرحلة المسودة، فلم يعد حذفها ممكنًا.",
      project_closed: "المشروع مغلق.",
      not_found: "لم يعد هذا البند متاحًا لك.",
      idempotency_key_reused: "لم ينجح ذلك. حاول مرة أخرى.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};

export const revisionPickerLabels: Record<Locale, RevisionPickerLabels> = {
  en: { label: "Revision" },
  ar: { label: "المراجعة" },
};
