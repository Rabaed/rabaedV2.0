import type { Locale } from "@rabaed/domain";
import type { ActionFormLabels } from "../components/form-engine/action-form.tsx";
import type { AttachmentsFieldLabels } from "../components/form-engine/attachments-field.tsx";
import type { ChecklistFieldLabels } from "../components/form-engine/checklist-field.tsx";
import type { FormRendererLabels } from "../components/form-engine/form-renderer.tsx";
import type { LinkQuestionLabels } from "../components/form-engine/link-question-field.tsx";
import type { LinkSearchLabels } from "../components/form-engine/link-search.tsx";
import type { LinkedFromLabels } from "../components/form-engine/linked-from.tsx";
import type { LinkedItemRowLabels } from "../components/form-engine/linked-item-row.tsx";
import type { LinksSectionLabels } from "../components/form-engine/links-section.tsx";
import type { PhotosFieldLabels } from "../components/form-engine/photos-field.tsx";

// Story copy for the Form engine: the labels the app passes from its messages
// (apps/web/messages), in English and Arabic. The plural wording is written out
// here as the messages' plural rules give it: Arabic counts one, two (dual),
// 3 to 10 (plural) and 11 and more (singular accusative).

const linkedItemRow: Record<Locale, LinkedItemRowLabels> = {
  en: { hidden: "You are not allowed to see the details of this item." },
  ar: { hidden: "غير مسموح لك برؤية تفاصيل هذا البند." },
};

export const linkSearchLabels: Record<Locale, LinkSearchLabels> = {
  en: {
    label: "Find an item to link",
    hint: "Type part of a Document Number or Subject.",
    results: "Search results",
    searching: "Searching…",
    noMatch: "No items match.",
    offered: "Only Submitted items you can see in this Project can be linked.",
    failed: "Couldn't search. Try again.",
    more: "Show more",
    count: (n, count, more) => `${count === 1 ? "1 item" : `${n} items`}${more ? ", more below" : ""}`,
  },
  ar: {
    label: "ابحث عن بند لربطه",
    hint: "اكتب جزءًا من رقم المستند أو الموضوع.",
    results: "نتائج البحث",
    searching: "جارٍ البحث…",
    noMatch: "لا توجد بنود مطابقة.",
    offered: "يمكن ربط البنود المقدَّمة التي تراها في هذا المشروع فقط.",
    failed: "تعذّر البحث. حاول مرة أخرى.",
    more: "عرض المزيد",
    count: (n, count, more) =>
      `${count === 1 ? "بند واحد" : count === 2 ? "بندان" : count <= 10 ? `${n} بنود` : `${n} بندًا`}${more ? "، والمزيد أدناه" : ""}`,
  },
};

export const linksSectionLabels: Record<Locale, LinksSectionLabels> = {
  en: {
    title: "Links",
    none: "No Links yet.",
    remove: (number) => `Remove the Link to ${number}`,
    item: linkedItemRow.en,
    search: linkSearchLabels.en,
  },
  ar: {
    title: "الروابط",
    none: "لا توجد روابط بعد.",
    remove: (number) => `إزالة الربط مع \u2066${number}\u2069`,
    item: linkedItemRow.ar,
    search: linkSearchLabels.ar,
  },
};

export const linkedFromLabels: Record<Locale, LinkedFromLabels> = {
  en: { title: "Linked from", none: "No Submitted item links here yet.", item: linkedItemRow.en },
  ar: { title: "مرتبط من", none: "لا يرتبط بهذا البند أي بند مُقدَّم بعد.", item: linkedItemRow.ar },
};

const linkQuestion: Record<Locale, LinkQuestionLabels> = {
  en: { remove: (number) => `Remove ${number}`, item: linkedItemRow.en, search: linkSearchLabels.en },
  ar: { remove: (number) => `إزالة \u2066${number}\u2069`, item: linkedItemRow.ar, search: linkSearchLabels.ar },
};

const attachments: Record<Locale, AttachmentsFieldLabels> = {
  en: {
    none: "No Documents yet.",
    notYet: "Documents can be added once the Draft is saved.",
    uploading: "Uploading…",
    open: (name) => `Open ${name}`,
    remove: (name) => `Remove ${name}`,
    frozen: "Sent: can't be changed",
    kb: (size) => `${size} KB`,
    mb: (size) => `${size} MB`,
    accepts: (types) => `${types} only`,
    atMost: (n, count) => (count === 1 ? "At most 1 Document" : `At most ${n} Documents`),
    full: (n, count) => (count === 1 ? "This field takes 1 Document." : `This field takes at most ${n} Documents.`),
  },
  ar: {
    none: "لا توجد مستندات بعد.",
    notYet: "يمكن إضافة المستندات بعد حفظ المسودة.",
    uploading: "جارٍ الرفع…",
    open: (name) => `فتح \u2068${name}\u2069`,
    remove: (name) => `إزالة \u2068${name}\u2069`,
    frozen: "مُرسَل: لا يمكن تغييره",
    kb: (size) => `${size} ك.ب`,
    mb: (size) => `${size} م.ب`,
    accepts: (types) => `\u2066${types}\u2069 فقط`,
    atMost: (n, count) =>
      count === 1
        ? "مستند واحد على الأكثر"
        : count === 2
          ? "مستندان على الأكثر"
          : count <= 10
            ? `${n} مستندات على الأكثر`
            : `${n} مستندًا على الأكثر`,
    full: (n, count) =>
      count === 1
        ? "يقبل هذا الحقل مستندًا واحدًا."
        : count === 2
          ? "يقبل هذا الحقل مستندين على الأكثر."
          : count <= 10
            ? `يقبل هذا الحقل ${n} مستندات على الأكثر.`
            : `يقبل هذا الحقل ${n} مستندًا على الأكثر.`,
  },
};

const photos: Record<Locale, PhotosFieldLabels> = {
  en: {
    none: "No photos yet.",
    notYet: "Photos can be added once the Draft is saved.",
    uploading: "Uploading…",
    takePhoto: "Take a photo",
    open: (name) => `Open ${name} full size`,
    remove: (name) => `Remove ${name}`,
    frozen: "Sent: can't be changed",
    taken: (when) => `Taken ${when}`,
    nothingRecorded: "No time/location recorded",
    noTime: "No time recorded",
    noPlace: "No location recorded",
    atMost: (n, count) => (count === 1 ? "At most 1 photo" : `At most ${n} photos`),
    full: (n, count) => (count === 1 ? "This field takes 1 photo." : `This field takes at most ${n} photos.`),
  },
  ar: {
    none: "لا توجد صور بعد.",
    notYet: "يمكن إضافة الصور بعد حفظ المسودة.",
    uploading: "جارٍ الرفع…",
    takePhoto: "التقط صورة",
    open: (name) => `فتح \u2068${name}\u2069 بالحجم الكامل`,
    remove: (name) => `إزالة \u2068${name}\u2069`,
    frozen: "مُرسَل: لا يمكن تغييره",
    taken: (when) => `التُقطت ${when}`,
    nothingRecorded: "لم يُسجَّل وقت أو موقع",
    noTime: "لم يُسجَّل وقت",
    noPlace: "لم يُسجَّل موقع",
    atMost: (n, count) =>
      count === 1 ? "صورة واحدة على الأكثر" : count === 2 ? "صورتان على الأكثر" : count <= 10 ? `${n} صور على الأكثر` : `${n} صورة على الأكثر`,
    full: (n, count) =>
      count === 1
        ? "يقبل هذا الحقل صورة واحدة."
        : count === 2
          ? "يقبل هذا الحقل صورتين على الأكثر."
          : count <= 10
            ? `يقبل هذا الحقل ${n} صور على الأكثر.`
            : `يقبل هذا الحقل ${n} صورة على الأكثر.`,
  },
};

const checklist: Record<Locale, ChecklistFieldLabels> = {
  en: {
    comment: "Comment",
    photos: "Photos",
    required: "required",
    notAnswered: "Not answered",
    answerThis: "Answer this item.",
    commentNeeded: "Add a comment to explain this answer.",
    photoNeeded: "Add a photo as evidence for this answer.",
    wrongType: "This value isn't valid here.",
    unknownOption: "Choose one of the answers.",
    tooLong: (max) => `Use at most ${max} characters.`,
    summary: "Summary",
    evidence: (item) => `Photos for ${item}`,
    itemNumber: (n, of) => `${n} of ${of}`,
    photosField: photos.en,
  },
  ar: {
    comment: "التعليق",
    photos: "الصور",
    required: "مطلوب",
    notAnswered: "لم تتم الإجابة",
    answerThis: "أجب عن هذا البند.",
    commentNeeded: "أضف تعليقًا يوضح هذه الإجابة.",
    photoNeeded: "أضف صورة كدليل لهذه الإجابة.",
    wrongType: "هذه القيمة غير صالحة هنا.",
    unknownOption: "اختر إحدى الإجابات.",
    tooLong: (max) => `استخدم ${max} حرفًا على الأكثر.`,
    summary: "الملخص",
    evidence: (item) => `صور \u2068${item}\u2069`,
    itemNumber: (n, of) => `${n} من ${of}`,
    photosField: photos.ar,
  },
};

export const formRendererLabels: Record<Locale, FormRendererLabels> = {
  en: {
    summary: (n, count) => (count === 1 ? "1 field needs your attention:" : `${n} fields need your attention:`),
    required: "This field is required.",
    wrongType: "This value isn't valid here.",
    tooLong: (max) => `Use at most ${max} characters.`,
    invalidFormat: {
      date: "Enter a valid date.",
      time: "Enter a valid time.",
      datetime: "Enter a valid date and time.",
      email: "Enter a valid email address, such as name@company.com.",
      phone: "Enter a valid phone number, such as 050 123 4567 or +966 50 123 4567.",
    },
    notANumber: "Enter a number.",
    belowMin: (min) => `Enter ${min} or more.`,
    aboveMax: (max) => `Enter ${max} or less.`,
    tooManyDecimals: (n, count) =>
      count === 0 ? "Enter a whole number." : count === 1 ? "Use at most 1 decimal place." : `Use at most ${n} decimal places.`,
    unknownOption: "Choose one of the options.",
    notWorkedOut: "Not worked out yet",
    calculatedRequired: "Fill in the fields this is worked out from.",
    tooShallow: "Keep choosing down to the last level.",
    tooFewRows: (n, count) => (count === 1 ? "Add at least 1 row." : `Add at least ${n} rows.`),
    tooManyRows: (n, count) => (count === 1 ? "Use at most 1 row." : `Use at most ${n} rows.`),
    tooFewFiles: (n, count) => (count === 1 ? "Add at least 1 Document." : `Add at least ${n} Documents.`),
    choose: "Choose…",
    none: "None",
    // The name sits in an isolate (\u2068 first strong, \u2069 ends), so an Arabic name keeps its place.
    leftProject: (name) => `\u2068${name}\u2069 (no longer on the Project)`,
    unanswered: "Not answered",
    filledBy: (role) => `Filled in by the ${role}`,
    builtIn: { choose: "Choose…", chooseTradeFirst: "Choose a Trade first.", noScopes: "This Trade has no Scopes." },
    attachments: attachments.en,
    photos: photos.en,
    checklist: checklist.en,
    table: {
      addRow: "Add row",
      row: (n) => `Row ${n}`,
      removeRow: (n) => `Remove row ${n}`,
      noRows: "No rows yet.",
      limitReached: (max) => `The most rows allowed is ${max}.`,
      total: (column) => `Total ${column}`,
      wrongType: "This row isn't valid here.",
    },
    optionList: { level: (n) => `Level ${n}`, choose: "Choose…", none: "None", unavailable: "This list isn't available." },
    linkQuestion: linkQuestion.en,
  },
  ar: {
    summary: (n, count) =>
      count === 1
        ? "حقل واحد يحتاج إلى مراجعتك:"
        : count === 2
          ? "حقلان يحتاجان إلى مراجعتك:"
          : count <= 10
            ? `${n} حقول تحتاج إلى مراجعتك:`
            : `${n} حقلًا يحتاج إلى مراجعتك:`,
    required: "هذا الحقل مطلوب.",
    wrongType: "هذه القيمة غير صالحة هنا.",
    tooLong: (max) => `استخدم ${max} حرفًا على الأكثر.`,
    // Latin examples and limits sit in isolates (\u2066 left to right, \u2067 right to left, \u2069 ends), so a + or a unit stays in place.
    invalidFormat: {
      date: "أدخل تاريخًا صالحًا.",
      time: "أدخل وقتًا صالحًا.",
      datetime: "أدخل تاريخًا ووقتًا صالحين.",
      email: "أدخل بريدًا إلكترونيًا صالحًا، مثل \u2066name@company.com\u2069.",
      phone: "أدخل رقم هاتف صالحًا، مثل \u2066050 123 4567\u2069 أو \u2066+966 50 123 4567\u2069.",
    },
    notANumber: "أدخل رقمًا.",
    belowMin: (min) => `أدخل \u2067${min}\u2069 أو أكثر.`,
    aboveMax: (max) => `أدخل \u2067${max}\u2069 أو أقل.`,
    tooManyDecimals: (n, count) =>
      count === 0
        ? "أدخل عددًا صحيحًا."
        : count === 1
          ? "استخدم منزلة عشرية واحدة على الأكثر."
          : count === 2
            ? "استخدم منزلتين عشريتين على الأكثر."
            : `استخدم ${n} منازل عشرية على الأكثر.`,
    unknownOption: "اختر أحد الخيارات.",
    notWorkedOut: "لم يُحسب بعد",
    calculatedRequired: "أكمل الحقول التي يُحسب منها.",
    tooShallow: "تابع الاختيار حتى المستوى الأخير.",
    tooFewRows: (n, count) =>
      count === 1 ? "أضف صفًا واحدًا على الأقل." : count === 2 ? "أضف صفين على الأقل." : count <= 10 ? `أضف ${n} صفوف على الأقل.` : `أضف ${n} صفًا على الأقل.`,
    tooManyRows: (n, count) =>
      count === 1
        ? "استخدم صفًا واحدًا على الأكثر."
        : count === 2
          ? "استخدم صفين على الأكثر."
          : count <= 10
            ? `استخدم ${n} صفوف على الأكثر.`
            : `استخدم ${n} صفًا على الأكثر.`,
    tooFewFiles: (n, count) =>
      count === 1
        ? "أضف مستندًا واحدًا على الأقل."
        : count === 2
          ? "أضف مستندين على الأقل."
          : count <= 10
            ? `أضف ${n} مستندات على الأقل.`
            : `أضف ${n} مستندًا على الأقل.`,
    choose: "اختر…",
    none: "بدون",
    leftProject: (name) => `\u2068${name}\u2069 (لم يعد في المشروع)`,
    unanswered: "لم تتم الإجابة",
    filledBy: (role) => `يعبّئه ${role}`,
    builtIn: { choose: "اختر…", chooseTradeFirst: "اختر التخصص أولًا.", noScopes: "لا توجد نطاقات لهذا التخصص." },
    attachments: attachments.ar,
    photos: photos.ar,
    checklist: checklist.ar,
    table: {
      addRow: "إضافة صف",
      row: (n) => `الصف ${n}`,
      removeRow: (n) => `حذف الصف ${n}`,
      noRows: "لا توجد صفوف بعد.",
      limitReached: (max) => `أقصى عدد للصفوف هو ${max}.`,
      total: (column) => `إجمالي ${column}`,
      wrongType: "هذا الصف غير صالح هنا.",
    },
    optionList: { level: (n) => `المستوى ${n}`, choose: "اختر…", none: "بدون", unavailable: "هذه القائمة غير متاحة." },
    linkQuestion: linkQuestion.ar,
  },
};

export const actionFormLabels: Record<Locale, ActionFormLabels> = {
  en: {
    internalNote: "Internal Note",
    internalNoteHelp:
      "Optional. Only your Company sees it, even when the item goes to another Company. Anything for them goes in Chat or the Form.",
    form: formRendererLabels.en,
  },
  ar: {
    internalNote: "ملاحظة داخلية",
    internalNoteHelp: "اختيارية. لا يراها إلا شركتك، حتى عندما ينتقل العنصر إلى شركة أخرى. ما يخصهم يُكتب في المحادثة أو النموذج.",
    form: formRendererLabels.ar,
  },
};
