import { intlLocaleOf, type Locale } from "@rabaed/domain";
import ar from "../../../../apps/web/messages/ar.json" with { type: "json" };
import en from "../../../../apps/web/messages/en.json" with { type: "json" };
import type { NumberingCountersLabels } from "../components/numbering/numbering-counters.tsx";
import type { NumberingText } from "../components/numbering/numbering-text.tsx";
import type { ParticipantCodesLabels } from "../components/numbering/participant-codes.tsx";

// Story copy for Document Numbering: the labels the app passes from its messages
// (apps/web/messages), in English and Arabic. The page's words (RP-412) are read
// from the app's message files themselves, so the stories show exactly its copy.

const messages = { en, ar } as const;

/**
 * An ICU `{count, plural, …}` message's branch for a count, as next-intl picks it: an
 * exact `=n`, else the locale's plural category (Arabic: zero, one, two, few, many, other).
 */
function plural(message: string, locale: Locale, values: Record<string, string | number>): string {
  const head = /^\{(\w+), plural,/.exec(message);
  if (!head) return message;
  const count = Number(values[head[1]!]);
  const branches = new Map<string, string>();
  let i = head[0].length;
  while (i < message.length - 1) {
    const key = /^\s*(=?\w+)\s*\{/.exec(message.slice(i));
    if (!key) break;
    i += key[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0) {
      if (message[i] === "{") depth += 1;
      else if (message[i] === "}") depth -= 1;
      i += 1;
    }
    branches.set(key[1]!, message.slice(start, i - 1));
  }
  return branches.get(`=${count}`) ?? branches.get(new Intl.PluralRules(intlLocaleOf(locale)).select(count)) ?? branches.get("other") ?? message;
}

/** The app's `numbering.page` messages as next-intl gives them: a key, plural branches chosen, `{name}` placeholders filled in. */
export function numberingText(locale: Locale): NumberingText {
  const page = messages[locale].numbering.page as Record<string, unknown>;
  return (key, values = {}) => {
    const found = key.split(".").reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], page);
    if (typeof found !== "string") throw new Error(`No numbering.page message ${key}`);
    return plural(found, locale, values).replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
  };
}

export const participantCodesLabels: Record<Locale, ParticipantCodesLabels> = Object.fromEntries(
  (["en", "ar"] as const).map((locale) => {
    const m = messages[locale].numbering.participantCodes;
    return [
      locale,
      {
        title: m.title,
        intro: m.intro,
        participants: m.participants,
        colParticipant: m.colParticipant,
        colOrder: m.colOrder,
        colCode: m.colCode,
        codeOf: (company: string) => m.codeOf.replace("{company}", company),
        locked: m.locked,
        noCode: m.noCode,
        editOf: (company: string) => m.editOf.replace("{company}", company),
        saving: m.saving,
        saved: m.saved,
        refusals: {
          invalid: m.invalid,
          duplicate_code: m.duplicateCode,
          code_in_use: m.codeInUse,
          forbidden: m.forbidden,
          unavailable: m.unavailable,
        },
      },
    ];
  }),
) as Record<Locale, ParticipantCodesLabels>;

export const numberingCountersLabels: Record<Locale, NumberingCountersLabels> = {
  en: {
    title: "Counters",
    intro: "Each counter issues the sequence of the numbers it counts. Only Project Admins see counters.",
    counter: "Counter",
    lastNumber: "Last number",
    state: "State",
    none: "No counters yet. A counter starts with the first number it issues.",
    inUse: "In use",
    startsAt: (n) => `Starts at ${n}`,
    startTitle: "Set a starting number",
    startIntro:
      "Continuing a paper register? Set the number the counter issues next, before it issues its first. It can't change after that.",
    type: "Work Item Type",
    participant: "Participant",
    trade: "Trade",
    location: "Location",
    notCounted: "Not counted",
    startingNumber: "Starting number",
    next: "The next number will be",
    used: (n) => `This counter has already issued numbers, up to ${n}. Its starting number can't change.`,
    save: "Set starting number",
    saved: "Starting number set. The next number will be",
    refusals: {
      participant_required: "Choose a Participant: the Numbering Pattern counts by it.",
      trade_required: "Choose a Trade: the Numbering Pattern counts by it.",
      location_required: "Choose a Location: the Numbering Pattern counts by it.",
      value_not_found: "That choice is no longer on the Project. Reload the page.",
      type_not_found: "That Work Item Type is no longer on the Project. Reload the page.",
      counter_used: "This counter has issued a number since. Its starting number can't change.",
      project_closed: "The Project is closed.",
      not_found: "You can't change numbering on this Project.",
      invalid: "Enter a whole number from 1 to 9,999,999.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    title: "العدّادات",
    intro: "يُصدر كل عدّاد تسلسل الأرقام التي يعدّها. لا يرى العدّادات إلا مسؤولو المشروع.",
    counter: "العدّاد",
    lastNumber: "آخر رقم",
    state: "الحالة",
    none: "لا توجد عدّادات بعد. يبدأ العدّاد بأول رقم يُصدره.",
    inUse: "مستخدم",
    startsAt: (n) => `يبدأ من ${n}`,
    startTitle: "تحديد رقم البداية",
    startIntro: "هل تواصلون سجلًا ورقيًا؟ حدّدوا الرقم الذي يُصدره العدّاد تاليًا قبل أن يُصدر أول رقم. لا يمكن تغييره بعد ذلك.",
    type: "نوع البند",
    participant: "المشارك",
    trade: "التخصص",
    location: "الموقع",
    notCounted: "غير معدود",
    startingNumber: "رقم البداية",
    next: "سيكون الرقم التالي",
    used: (n) => `أصدر هذا العدّاد أرقامًا بالفعل حتى ${n}. لا يمكن تغيير رقم بدايته.`,
    save: "تحديد رقم البداية",
    saved: "تم تحديد رقم البداية. سيكون الرقم التالي",
    refusals: {
      participant_required: "اختر مشاركًا: نمط الترقيم يعدّ حسبه.",
      trade_required: "اختر تخصصًا: نمط الترقيم يعدّ حسبه.",
      location_required: "اختر موقعًا: نمط الترقيم يعدّ حسبه.",
      value_not_found: "لم يعد هذا الاختيار في المشروع. أعد تحميل الصفحة.",
      type_not_found: "لم يعد نوع البند هذا في المشروع. أعد تحميل الصفحة.",
      counter_used: "أصدر هذا العدّاد رقمًا منذ ذلك الحين. لا يمكن تغيير رقم بدايته.",
      project_closed: "المشروع مغلق.",
      not_found: "لا يمكنك تغيير الترقيم في هذا المشروع.",
      invalid: "أدخل عددًا صحيحًا من 1 إلى 9,999,999.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};
