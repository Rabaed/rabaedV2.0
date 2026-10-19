import type { Locale, RecordVerification } from "@rabaed/domain";
import type { RecordVerificationLabels, VerificationCodeFormLabels } from "../components/verification/record-verification.tsx";

// Story copy for the public verification page (RP-157): the labels the app passes from its messages
// (apps/web/messages, `verification`), in English and Arabic, and a made-up record.

export const verificationLabels: Record<Locale, RecordVerificationLabels> = {
  en: {
    genuine: "This record is genuine",
    replaced: "This record was replaced by a corrected copy on {date}",
    replacedHint: "Verify your copy below: an older copy is no longer the current record.",
    documentNumber: "Document Number",
    subject: "Subject",
    project: "Project",
    outcome: "Outcome",
    sealed: "Sealed",
    signers: "Signed by",
    checkCopy: "Verify your copy",
    checkCopyHint: "Drop the PDF you received here, or choose it. It is verified in your browser and never uploaded.",
    chooseFile: "Choose PDF",
    checking: "Verifying…",
    original: "This copy is the original record.",
    copyReplaced: "This copy was replaced by a corrected copy on {date}: it is not the current record.",
    different: "This PDF is not this record. It may have been changed.",
    noFile: "This PDF could not be read. Choose another.",
  },
  ar: {
    genuine: "هذا السجل أصلي",
    replaced: "استُبدل هذا السجل بنسخة مصححة في {date}",
    replacedHint: "تحقق من نسختك أدناه: النسخة الأقدم لم تعد السجل الحالي.",
    documentNumber: "رقم المستند",
    subject: "الموضوع",
    project: "المشروع",
    outcome: "النتيجة",
    sealed: "تاريخ التوثيق",
    signers: "الموقّعون",
    checkCopy: "تحقق من نسختك",
    checkCopyHint: "أفلت ملف PDF الذي استلمته هنا أو اختره. يُفحص في متصفحك ولا يُرفع أبدًا.",
    chooseFile: "اختر ملف PDF",
    checking: "جارٍ الفحص…",
    original: "هذه النسخة هي السجل الأصلي.",
    copyReplaced: "استُبدلت هذه النسخة بنسخة مصححة في {date}: وهي ليست السجل الحالي.",
    different: "هذا الملف ليس هذا السجل. ربما عُدّل.",
    noFile: "تعذرت قراءة الملف. اختر ملف PDF.",
  },
};

export const codeFormLabels: Record<Locale, VerificationCodeFormLabels> = {
  en: {
    title: "Verify a record by its code",
    hint: "Type the Verification Code printed under the record's QR and in its footer, with its Document Number.",
    code: "Verification Code",
    documentNumber: "Document Number",
    submit: "Verify",
  },
  ar: {
    title: "تحقق من سجل برمزه",
    hint: "اكتب رمز التحقق المطبوع أسفل رمز QR في السجل وفي تذييله، مع رقم المستند.",
    code: "رمز التحقق",
    documentNumber: "رقم المستند",
    submit: "تحقق",
  },
};

/** The bytes of the made-up record's PDF, its replaced copy, and another file, for the copy check. */
export const storyPdf = {
  original: new TextEncoder().encode("%PDF-1.7 the record as issued now (story)"),
  replaced: new TextEncoder().encode("%PDF-1.7 the copy a corrected one replaced (story)"),
  other: new TextEncoder().encode("%PDF-1.7 a changed copy (story)"),
};

/** Their SHA-256, worked out once (`sha256sum`), so the component's own Web Crypto result is checked against a known value. */
const storyPdfSha256 = {
  original: "7a7584ad5d34cb63ef9157238ecfbbb1ef784311f571bdef18100b7d5b2c8cf2",
  replaced: "1ad56c4e932ead7a1f7464096fe7e12cdaa12ba11a67de2bd718dc62641f7e6f",
};

/** A made-up record, genuine; `replaced` gives it a corrected copy that replaced `storyPdf.replaced`. */
export function storyVerification(replaced = false): RecordVerification {
  const replacedAt = "2027-08-30T09:15:00.000Z";
  return {
    status: replaced ? "replaced" : "genuine",
    replacedAt: replaced ? replacedAt : null,
    documentNumber: "TWR-MAR-01-0007 Rev 1",
    subject: "Cable trays for Building A",
    project: { en: "Riyadh Tower", ar: "برج الرياض" },
    outcome: { code: "A", name: { en: "Approved", ar: "معتمد" } },
    sealedAt: replaced ? replacedAt : "2027-08-21T11:40:00.000Z",
    signers: [
      { name: { en: "Omar Haddad", ar: "عمر حداد" }, positions: [{ en: "Engineer", ar: "مهندس" }], company: { en: "Al Noor Contracting", ar: "النور للمقاولات" } },
      { name: { en: "Sara Qahtani", ar: "سارة القحطاني" }, positions: [{ en: "Project Manager", ar: "مدير المشروع" }], company: { en: "Al Noor Contracting", ar: "النور للمقاولات" } },
      { name: { en: "Huda Harbi", ar: "هدى الحربي" }, positions: [{ en: "Manager", ar: "مدير" }], company: { en: "Delta Consultants", ar: "دلتا للاستشارات" } },
    ],
    fingerprints: {
      current: storyPdfSha256.original,
      replaced: replaced ? [{ sha256: storyPdfSha256.replaced, replacedAt }] : [],
    },
  };
}
