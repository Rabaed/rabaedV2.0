import type { Locale } from "@rabaed/domain";
import type { ParticipantCodesLabels } from "../components/numbering/participant-codes.tsx";

// Story copy for Numbering: the labels the app passes from its messages
// (apps/web/messages), in English and Arabic.

export const participantCodesLabels: Record<Locale, ParticipantCodesLabels> = {
  en: {
    title: "Participant Codes",
    intro:
      "Each Participant's code in Document Numbers: 2 to 6 letters or digits, at least one a letter. Until a code is set, numbers show the Participant's order on the Project. A code is fixed once a number uses it.",
    participants: "Participants",
    code: "Participant Code",
    order: "Order on the Project, until a code is set",
    noCode: "No code yet",
    save: "Save code",
    saved: "Participant Code saved.",
    refusals: {
      invalid: "Use 2 to 6 letters or digits, with at least one letter.",
      duplicate_code: "Another Participant on this Project already has that code.",
      code_in_use: "A Document Number already uses this code, so it can no longer change.",
      forbidden: "Only a Project Admin can set Participant Codes.",
      unavailable: "Something went wrong. Try again.",
    },
  },
  ar: {
    title: "رموز المشاركين",
    intro:
      "رمز كل مشارك في أرقام المستندات: من حرفين إلى 6 أحرف أو أرقام، على أن يكون بينها حرف واحد على الأقل. ما لم يُحدَّد الرمز، تعرض الأرقام ترتيب المشارك في المشروع. ويُثبَّت الرمز بمجرد أن يستخدمه رقم.",
    participants: "المشاركون",
    code: "رمز المشارك",
    order: "الترتيب في المشروع، إلى أن يُحدَّد رمز",
    noCode: "لا رمز بعد",
    save: "حفظ الرمز",
    saved: "تم حفظ رمز المشارك.",
    refusals: {
      invalid: "استخدم من حرفين إلى 6 أحرف أو أرقام، مع حرف واحد على الأقل.",
      duplicate_code: "يوجد مشارك آخر في هذا المشروع يستخدم هذا الرمز.",
      code_in_use: "يستخدم رقم مستند هذا الرمز بالفعل، فلم يعد قابلًا للتغيير.",
      forbidden: "لا يحدد رموز المشاركين إلا مسؤول المشروع.",
      unavailable: "حدث خطأ. حاول مرة أخرى.",
    },
  },
};
