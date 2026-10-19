import type { BilingualText, RecordLanguage } from "@rabaed/domain";

// Text in the record's language (ADR 0023, form-engine.md §5): with record
// language `bilingual` both Arabic and English, with `ar` or `en` only that one.
// The Record Data holds exactly what the pages print, so a single-language
// record never carries the other language.

export type { RecordLanguage };

/** Text in the languages the record prints: at least one is set. */
export interface RecordText {
  readonly ar?: string;
  readonly en?: string;
}

/** `text` in the record's languages. */
export function pick(text: BilingualText, language: RecordLanguage): RecordText {
  return language === "ar" ? { ar: text.ar } : language === "en" ? { en: text.en } : { ar: text.ar, en: text.en };
}

/** Text that is the same in every language (a typed value), in the record's. */
export function same(text: string, language: RecordLanguage): RecordText {
  return pick({ ar: text, en: text }, language);
}

/** Every language of `text` that is set, Arabic first. */
export function texts(text: RecordText): string[] {
  return [text.ar, text.en].filter((t): t is string => t !== undefined);
}

/** `s` escaped for HTML text and attributes. */
export const html = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Left to right whatever surrounds it: Document Numbers, codes, hashes, links. */
export const ltr = (s: string): string => `<bdi dir="ltr" class="ltr">${html(s)}</bdi>`;

/** The layout's own words (layout.ts, appendix-layout.ts), in both languages. */
export const WORDS = {
  project: { ar: "المشروع", en: "Project" },
  subject: { ar: "الموضوع", en: "Subject" },
  number: { ar: "رقم المستند", en: "Document Number" },
  parties: { ar: "الأطراف", en: "Parties" },
  classification: { ar: "التصنيف", en: "Classification" },
  trade: { ar: "التخصص", en: "Trade" },
  location: { ar: "الموقع", en: "Location" },
  scopes: { ar: "نطاق العمل", en: "Scopes" },
  decision: { ar: "القرار النهائي", en: "Final decision" },
  issuedBy: { ar: "أصدره", en: "Issued by" },
  confirmedBy: { ar: "أكّده", en: "Confirmed by" },
  submitted: { ar: "تاريخ التقديم", en: "Submission Date" },
  replied: { ar: "تاريخ الرد", en: "Reply date" },
  comments: { ar: "عدد الملاحظات", en: "Review Comments" },
  code: { ar: "رمز التحقق", en: "Verification Code" },
  link: { ar: "رابط التحقق", en: "Verification link" },
  reply: { ar: "الرد", en: "Reply" },
  flow: { ar: "مسار الاعتماد", en: "Approval flow" },
  step: { ar: "الإجراء", en: "Step" },
  member: { ar: "العضو", en: "Member" },
  company: { ar: "الشركة", en: "Company" },
  date: { ar: "التاريخ", en: "Date" },
  hash: { ar: "بصمة المحتوى", en: "Content hash" },
  documents: { ar: "المستندات", en: "Documents" },
  documentName: { ar: "المستند", en: "Document" },
  pages: { ar: "الصفحات", en: "Pages" },
  takenAt: { ar: "تاريخ التصوير", en: "Taken" },
  totals: { ar: "الإجمالي", en: "Total" },
  revisionOf: { ar: "مراجعة للمستند", en: "Revision of" },
  closedAtCode: { ar: "أُغلق بالرمز", en: "closed at Code" },
  closedOn: { ar: "بتاريخ", en: "on" },
  footer: { ar: "صادر إلكترونيًا عبر رابد", en: "Issued electronically through Rabaed" },
  page: { ar: "صفحة", en: "page" },
  of: { ar: "من", en: "of" },
  reviewDuration: { ar: "مدة المراجعة (أيام)", en: "Review duration (days)" },
  fullText: { ar: "النص الكامل: صفحة", en: "Full text: page" },
  cancelledBy: { ar: "ألغاه", en: "Cancelled by" },
  reason: { ar: "السبب", en: "Reason" },
  byRabaed: { ar: "ألغاه رابد:", en: "Cancelled by Rabaed:" },
  leftProject: { ar: "غادرت المشروع", en: "left the Project" },
  reviewComments: { ar: "ملاحظات المراجعة", en: "Review Comments" },
  reference: { ar: "المرجع", en: "Reference" },
  signatures: { ar: "التواقيع", en: "Signatures" },
  signature: { ar: "التوقيع", en: "Signature" },
  nextStep: { ar: "الخطوة التالية", en: "Next step" },
  revision: { ar: "المراجعة", en: "Revision" },
  by: { ar: "من", en: "by" },
  stamps: { ar: "الأختام", en: "Stamps" },
  disclaimer: { ar: "إخلاء المسؤولية", en: "Disclaimer" },
  // The appendix (RP-147).
  appendix: { ar: "الملحق", en: "Appendix" },
  fingerprint: { ar: "البصمة (SHA-256)", en: "Fingerprint (SHA-256)" },
  inThisRecord: { ar: "في هذا السجل", en: "In this record" },
  attachedInside: { ar: "مرفق داخل ملف PDF هذا", en: "Attached inside this PDF" },
  heldInRabaed: { ar: "محفوظ في رابد", en: "Held in Rabaed" },
  tooManyPages: { ar: "مرفق داخل ملف PDF هذا (صفحاته أكثر من أن تُعرض)", en: "Attached inside this PDF (too many pages to show)" },
  howToOpen: {
    ar: "المستندات المرفقة داخل هذا الملف تُفتح من أيقونة المرفقات (مشبك الورق) في قارئ PDF. المستندات المحفوظة في رابد تتجاوز الحد المسموح لحجم السجل، وتُعرف ببصماتها.",
    en: "Documents attached inside open from the PDF reader's attachments (paperclip). Documents held in Rabaed are past the record's size limit; their fingerprints identify them.",
  },
} satisfies Record<string, { ar: string; en: string }>;
export type Word = keyof typeof WORDS;

/** A heading: Arabic with its English label beside it (bilingual), or one language. */
export function headingHtml(word: Word, language: RecordLanguage): string {
  const w = WORDS[word];
  return language === "ar"
    ? `<span lang="ar">${w.ar}</span>`
    : language === "en"
      ? `<span lang="en" dir="ltr">${w.en}</span>`
      : `<span lang="ar">${w.ar}</span> <span lang="en" dir="ltr" class="en">${w.en}</span>`;
}
