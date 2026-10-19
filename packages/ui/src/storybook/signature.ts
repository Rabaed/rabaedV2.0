import type { Locale } from "@rabaed/domain";
import type { SignatureEditorLabels } from "../components/signature/signature-editor.tsx";
import type { SignatureRequiredLabels } from "../components/signature/signature-required-dialog.tsx";

// Story copy for Add Signature and its pop-up (RP-85): the labels the app passes from its
// messages (apps/web/messages, `signature`), in English and Arabic.

export const signatureEditorLabels: Record<Locale, SignatureEditorLabels> = {
  en: {
    methods: "How to add your Signature",
    drawn: "Draw",
    typed: "Type",
    uploaded: "Upload",
    pad: "Signature pad: draw with your mouse or finger",
    pen: "Pen",
    pens: { fine: "Fine", medium: "Medium", bold: "Bold" },
    ink: "Ink",
    inks: { black: "Black", blue: "Blue" },
    clear: "Clear",
    name: "Your full name",
    hand: "Handwriting",
    hands: { flowing: "Flowing", upright: "Upright" },
    preview: "Preview",
    file: "Image of your Signature",
    chooseFile: "Choose image",
    fileHelp: "A PNG or JPEG image, up to 512 KB.",
    save: "Save Signature",
    empty: "Draw, type or upload your Signature first.",
    refusals: {
      invalid_signature_image: "That image isn't a PNG or JPEG. Choose another.",
      file_type: "Choose a PNG or JPEG image.",
      file_too_large: "That image is larger than 512 KB. Choose a smaller one.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    methods: "طريقة إضافة توقيعك",
    drawn: "رسم",
    typed: "كتابة",
    uploaded: "رفع",
    pad: "لوحة التوقيع: ارسم بالفأرة أو بإصبعك",
    pen: "القلم",
    pens: { fine: "رفيع", medium: "متوسط", bold: "عريض" },
    ink: "الحبر",
    inks: { black: "أسود", blue: "أزرق" },
    clear: "مسح",
    name: "اسمك",
    hand: "الخط",
    hands: { flowing: "منساب", upright: "قائم" },
    preview: "معاينة",
    file: "صورة توقيعك",
    chooseFile: "اختر صورة",
    fileHelp: "صورة PNG أو JPEG، حتى 512 كيلوبايت.",
    save: "حفظ التوقيع",
    empty: "ارسم توقيعك أو اكتبه أو ارفعه أولًا.",
    refusals: {
      invalid_signature_image: "هذا الملف ليس صورة PNG أو JPEG. اختر ملفًا آخر.",
      file_type: "اختر صورة PNG أو JPEG.",
      file_too_large: "هذه الصورة أكبر من 512 كيلوبايت. اختر صورة أصغر.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};

export const signatureRequiredLabels: Record<Locale, SignatureRequiredLabels> = {
  en: {
    title: "Add your Signature first",
    body: "Every Transition you take records your Signature. Add it in your profile, and you'll come back here to carry on.",
    notNow: "Not now",
    close: "Close",
  },
  ar: {
    title: "أضف توقيعك أولًا",
    body: "كل انتقال تتخذه يسجّل توقيعك. أضفه في ملفك الشخصي، وستعود إلى هنا لتكمل.",
    notNow: "ليس الآن",
    close: "إغلاق",
  },
};

/** The pop-up's link to Profile → Add Signature, as the app words it. */
export const addSignatureLabel: Record<Locale, string> = { en: "Add Signature", ar: "إضافة توقيع" };
