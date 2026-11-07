import type { Locale } from "@rabaed/domain";
import type { ReplacementActionsLabels } from "../components/revision/replacement-actions.tsx";
import type { RevisionActionsLabels } from "../components/revision/revision-actions.tsx";
import type { RevisionBannerLabels, RevisionPickerLabels } from "../components/revision/revision-picker.tsx";

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

export const replacementActionsLabels: Record<Locale, ReplacementActionsLabels> = {
  en: {
    section: "Replacement",
    createIntro: "This item was rejected. Create a replacement: a new item with a new number, starting as a Draft with your answers and Documents.",
    create: "Create replacement",
    refusals: {
      replacement_not_allowed: "A replacement can't be created from this item now. Reload the page to see why.",
      project_closed: "The Project is closed.",
      not_found: "This item is no longer available to you.",
      idempotency_key_reused: "That didn't work. Try again.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    section: "البديل",
    createIntro: "رُفض هذا البند. أنشئ بديلًا له: بندًا جديدًا برقم جديد، يبدأ مسودةً فيها إجاباتك ومستنداتك.",
    create: "إنشاء بديل",
    refusals: {
      replacement_not_allowed: "لا يمكن إنشاء بديل من هذا البند الآن. أعد تحميل الصفحة لمعرفة السبب.",
      project_closed: "المشروع مغلق.",
      not_found: "لم يعد هذا البند متاحًا لك.",
      idempotency_key_reused: "لم ينجح ذلك. حاول مرة أخرى.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};

const revisionNames = (original: string) => ({ rev: (n: string) => `Rev ${n}`, original });

export const revisionPickerLabels: Record<Locale, RevisionPickerLabels> = {
  en: {
    revision: revisionNames("Original"),
    tooltip: "Open an earlier revision",
    title: "Revisions · each one came from a Code C",
    current: "Current",
    submitted: (date) => `Submitted ${date}`,
    closed: (date) => `Returned ${date}`,
  },
  ar: {
    revision: revisionNames("الأصلي"),
    tooltip: "فتح مراجعة سابقة",
    title: "المراجعات · كل منها نتج عن الرمز C",
    current: "الحالية",
    submitted: (date) => `قُدّمت ${date}`,
    closed: (date) => `أُعيدت ${date}`,
  },
};

export const revisionBannerLabels: Record<Locale, RevisionBannerLabels> = {
  en: {
    revision: revisionNames("Original"),
    viewing: (revision, code) => (code ? `You are viewing ${revision} · Code ${code}` : `You are viewing ${revision}`),
    replaced: (latest) => `Replaced by ${latest}. Read only — the form, attachments, chat and log exactly as they were.`,
    goTo: (latest) => `Go to ${latest}`,
  },
  ar: {
    revision: revisionNames("الأصلي"),
    viewing: (revision, code) => (code ? `أنت تعرض ${revision} · الرمز ${code}` : `أنت تعرض ${revision}`),
    replaced: (latest) => `استُبدلت بـ ${latest}. للقراءة فقط — النموذج والمرفقات والمحادثة والسجل كما كانت.`,
    goTo: (latest) => `الانتقال إلى ${latest}`,
  },
};
