import { intlLocaleOf, type Locale } from "@rabaed/domain";
import type { Translate } from "@rabaed/ui";
import { IntlMessageFormat } from "intl-messageformat";
import { messagesOf } from "./messages.ts";

// Rabaed Admin's Register Import (RP-645): the wizard's words are the customer app's
// `registerImport` messages (messages.ts), so it reads the same everywhere, except where those
// speak to the importer ("you", "your Company"): here the Engineer imports for a Company, its
// default Member standing where the importer stands. And the Company & reason step's own words.

const overrides: Record<Locale, Record<string, string>> = {
  en: {
    "map.formFieldsHelp":
      "Form fields show only the simple fields (text, number, date, list, a Member or Company) of the Types the default Member may raise. A field a row's Type doesn't have is left empty.",
    "assign.unknownEmails":
      "{count, plural, one {1 row: its email matches nobody of this Company} other {{n} rows: their email matches nobody of this Company}}",
    "assign.help":
      "Order: the “Assign to” column, then group rules, then the default Member. Only Members of this Company on this Project can be picked. An assignee who can't create the row's Type, or doesn't cover its Trade or Location, makes the row bad.",
    "reasons.type_not_allowed": "The default Member can't raise {value}",
    "reasons.trade_outside_visibility": "Trade {value} is outside the default Member's Visibility",
    "reasons.location_outside_visibility": "Location {value} is outside the default Member's Visibility",
    "reasons.paper_ref_taken": "Paper ref ‘{value}’ is already on a submittal of this Company here",
    "reasons.assignee_unknown": "‘{value}’ isn't an active Member of this Company on this Project",
    "reasons.assignee_unknown_picked": "The Member picked is no longer an active Member of this Company on this Project",
    "errors.typeNotFound": "The default Member can't raise that Type.",
    "errors.forbidden": "The default Member can't raise Submittals on this Project.",
    "errors.fieldNotFound": "A mapped Form field isn't on a Type the default Member may raise any more. Map the fields again.",
    "errors.notFound": "The default Member, their Company or this Project isn't available any more. Change whom the import is for.",
  },
  ar: {
    "map.formFieldsHelp":
      "تظهر من حقول النموذج الحقول البسيطة فقط (نص، رقم، تاريخ، قائمة، عضو أو شركة) للأنواع التي يمكن للعضو الافتراضي إنشاؤها. ويبقى فارغًا كل حقل لا يملكه نوع الصف.",
    "assign.unknownEmails":
      "{count, plural, one {صف واحد لا يسمّي أحداً من هذه الشركة} two {صفان لا يسمّيان أحداً من هذه الشركة} few {{n} صفوف لا تسمّي أحداً من هذه الشركة} many {{n} صفاً لا تسمّي أحداً من هذه الشركة} other {{n} صف لا تسمّي أحداً من هذه الشركة}}",
    "assign.help":
      "الترتيب: عمود «إسناد إلى»، ثم قواعد المجموعات، ثم العضو الافتراضي. لا يمكن اختيار إلا أعضاء هذه الشركة في هذا المشروع. المُسند إليه الذي لا يستطيع إنشاء نوع الصف، أو لا يغطي تخصصه أو موقعه، يجعل الصف خاطئاً.",
    "reasons.type_not_allowed": "لا يمكن للعضو الافتراضي إنشاء {value}",
    "reasons.trade_outside_visibility": "التخصص {value} خارج نطاق رؤية العضو الافتراضي",
    "reasons.location_outside_visibility": "الموقع {value} خارج نطاق رؤية العضو الافتراضي",
    "reasons.paper_ref_taken": "المرجع الورقي «{value}» موجود على اعتماد لهذه الشركة هنا",
    "reasons.assignee_unknown": "‘{value}’ ليس عضواً نشطاً في هذه الشركة في هذا المشروع",
    "reasons.assignee_unknown_picked": "العضو المختار لم يعد عضواً نشطاً في هذه الشركة في هذا المشروع",
    "errors.typeNotFound": "لا يمكن للعضو الافتراضي إنشاء هذا النوع.",
    "errors.forbidden": "لا يمكن للعضو الافتراضي إنشاء تقديمات في هذا المشروع.",
    "errors.fieldNotFound": "أحد حقول النموذج المربوطة لم يعد في نوع يمكن للعضو الافتراضي إنشاؤه. اربط الحقول من جديد.",
    "errors.notFound": "لم يعد هذا المشروع أو هذه الشركة أو العضو الافتراضي متاحاً. غيّر الجهة التي يتم الاستيراد لصالحها.",
  },
};

const formats = new Map<string, IntlMessageFormat>();

/** The wizard's `registerImport` messages in Rabaed Admin: the customer app's, with Admin's words where they differ. */
export function registerImportMessages(locale: Locale): Translate {
  const app = messagesOf(locale, "registerImport");
  return (key, values) => {
    const own = overrides[locale][key];
    if (own === undefined) return app(key, values);
    const cacheKey = `${locale}:${key}`;
    let format = formats.get(cacheKey);
    if (!format) {
      format = new IntlMessageFormat(own, intlLocaleOf(locale));
      formats.set(cacheKey, format);
    }
    return String(format.format(values));
  };
}

/** The Imports page's own words: the Company & reason step and the line saying whom the import is for. */
const pageWords = {
  en: {
    title: "Import register for a company",
    subtitle: "Runs the same import a Member would run: the import belongs to the company you pick.",
    breadcrumb: "Where you are",
    imports: "Imports",
    newImport: "New import",
    step: "Company & reason",
    reason: "Reason",
    reasonPlaceholder: "e.g. TMC asked for help loading their Rev 4 register",
    reasonKept:"Kept with the import. Members of the company see “Rabaed” as who imported, never you.",
    reasonFirst: "Give the reason first: every read of a company's data is logged with it.",
    load: "Show the Projects",
    project: "Project",
    chooseProject: "Choose a Project…",
    company: "Company (Participant) the import is for",
    raisesNone: "doesn't raise submittals",
    defaultMember: "Default Member who raises the Drafts",
    defaultHelp: "An “Assign to” value in the register overrides this per row.",
    chooseMember: "Choose a Member…",
    cannotImport: "can't raise submittals",
    importingFor: "Importing for",
    defaultRaiser: "Default raiser",
    reasonIs: "Reason:",
    change: "Change",
    loadFailed: "Couldn't load this. Try again.",
    defaultMemberNotFound: "That Member isn't an active Member of the Company on this Project any more. Choose another.",
    forbidden: "That Member can't raise submittals on this Project. Choose another.",
    another: "Import another register",
  },
  ar: {
    title: "استيراد السجل لصالح شركة",
    subtitle: "يشغّل نفس الاستيراد الذي يشغّله العضو: يعود الاستيراد للشركة التي تختارها.",
    breadcrumb: "موقعك",
    imports: "عمليات الاستيراد",
    newImport: "استيراد جديد",
    step: "الشركة والسبب",
    reason: "السبب",
    reasonPlaceholder: "مثال: طلبت TMC المساعدة في إدخال سجلها Rev 4",
    reasonKept: "يُحفظ مع الاستيراد. يرى أعضاء الشركة «ربائد» كجهة الاستيراد، وليس أنت.",
    reasonFirst: "اكتب السبب أولاً: تُسجَّل معه كل قراءة لبيانات شركة.",
    load: "عرض المشاريع",
    project: "المشروع",
    chooseProject: "اختر مشروعاً…",
    company: "الشركة (المشارك) التي يتم الاستيراد لصالحها",
    raisesNone: "لا ترفع تقديمات",
    defaultMember: "العضو الافتراضي الذي يرفع المسودات",
    defaultHelp: "قيمة «إسناد إلى» في السجل تتجاوز هذا لكل صف.",
    chooseMember: "اختر عضواً…",
    cannotImport: "لا يمكنه إنشاء تقديمات",
    importingFor: "الاستيراد لصالح",
    defaultRaiser: "المُنشئ الافتراضي",
    reasonIs: "السبب:",
    change: "تغيير",
    loadFailed: "تعذّر التحميل. حاول مرة أخرى.",
    defaultMemberNotFound: "لم يعد هذا العضو عضواً نشطاً في الشركة في هذا المشروع. اختر غيره.",
    forbidden: "لا يمكن لهذا العضو إنشاء تقديمات في هذا المشروع. اختر غيره.",
    another: "استيراد سجل آخر",
  },
};

export type ImportPageWords = (typeof pageWords)["en"];
export const importPageWords = (locale: Locale): ImportPageWords => pageWords[locale];
