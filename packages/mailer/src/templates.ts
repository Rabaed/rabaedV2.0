import {
  directionOf,
  formatNumber,
  stepAgeReportGroups,
  type BilingualText,
  type Locale,
  type NotificationDigestItem,
  type NotificationEmailContent,
  type NotificationEmailKind,
  type StepAgeReportItem,
  type StepAgeReportWeeks,
} from "@rabaed/domain";

/** A notification email's values: what the recipient may see of the item at send time, and the link to it on the web. */
export interface NotificationEmailValues extends NotificationEmailContent {
  link: string;
}

/** The daily digest's values: per Project, the items and what happened to each, with the link to each item on the web. */
export interface DailyDigestValues {
  projects: { name: BilingualText; items: (NotificationDigestItem & { link: string })[] }[];
}

/** The values each email template needs. */
export interface EmailTemplateValues {
  /** Rabaed Admin's one-time sign-in code (ADR 0010). */
  "sign-in-code": { code: string; validMinutes: number };
  /** An invitation to become a Member of a Company; the link opens accept-invitation. */
  invitation: { companyName: string; link: string };
  /** Rabaed Admin: a Rabaed Engineer signed in from a browser it hasn't seen (ADR 0010). */
  "new-device-sign-in": { when: string; ip: string };
  /** Rabaed Admin: too many failed sign-ins; sign-in is refused for a while. */
  "sign-in-locked": { minutes: number };
  /** A Step reached the Member or their Step Pool. */
  "notification-step-reached": NotificationEmailValues;
  /** Something happened on an item the Member watches. */
  "notification-watched-event": NotificationEmailValues;
  /** An item was Sent Back to the Member's Participant (RP-356). */
  "notification-sent-back": NotificationEmailValues;
  /** A Step in the Member's Company has nobody to hold it (RP-356). */
  "notification-vacancy": NotificationEmailValues;
  /** The daily digest of the notifications routed to it (RP-358). */
  "daily-digest": DailyDigestValues;
  /** The weekly Step Age report (RP-359). */
  "step-age-report": StepAgeReportValues;
}

/** A weekly Step Age report's values: its items as the recipient sees them, oldest first, and the links to the List of them. */
export interface StepAgeReportValues {
  projectName: BilingualText;
  items: readonly StepAgeReportItem[];
  /** The List showing the report's items. */
  link: string;
  /** The List showing those 4 weeks or more at their Step. */
  oldestLink: string;
}

export type EmailTemplate = keyof EmailTemplateValues;

/** The template each kind of notification is emailed with. */
export const notificationEmailTemplate = {
  step_reached: "notification-step-reached",
  watched_event: "notification-watched-event",
  sent_back: "notification-sent-back",
  vacancy: "notification-vacancy",
} as const satisfies Record<NotificationEmailKind, EmailTemplate>;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * One email, ready to send: a subject, a plain-text body and an HTML body
 * with the locale's language and direction. Numbers are in Latin digits, and
 * codes and links stay left to right inside Arabic.
 */
export function renderEmail<T extends EmailTemplate>(template: T, locale: Locale, values: EmailTemplateValues[T]): RenderedEmail {
  const content = (templates[template] as (locale: Locale, values: EmailTemplateValues[T]) => Content)(locale, values);
  return {
    subject: content.subject,
    text: [...content.paragraphs.map(plain), content.signOff].join("\n\n") + "\n",
    html: page(locale, content),
  };
}

// A paragraph is text, with values marked to keep left to right: codes (shown
// large), links, and inline values such as times and addresses.
type Part = string | { ltr: string; link?: boolean; inline?: boolean };
type Paragraph = Part[];
interface Content {
  subject: string;
  paragraphs: Paragraph[];
  signOff: string;
}

const signOff: Record<Locale, string> = { en: "Rabaed", ar: "ربائد" };

type Template<V> = (locale: Locale, values: V) => Content;
type AccountTemplate = "sign-in-code" | "invitation" | "new-device-sign-in" | "sign-in-locked";

const accountTemplates: { [T in AccountTemplate]: Template<EmailTemplateValues[T]> } = {
  "sign-in-code": (locale, { code, validMinutes }) => {
    const minutes = formatNumber(validMinutes, locale);
    return locale === "ar"
      ? {
          subject: "رمز الدخول إلى إدارة ربائد",
          paragraphs: [["رمز الدخول الخاص بك:"], [{ ltr: code }], [`يعمل الرمز مرة واحدة، لمدة ${minutes} ${arabicMinutes(validMinutes)}. إن لم تطلبه، تجاهل هذه الرسالة.`]],
          signOff: signOff.ar,
        }
      : {
          subject: "Your Rabaed Admin sign-in code",
          paragraphs: [["Your sign-in code:"], [{ ltr: code }], [`It works once, for ${minutes} minutes. If you didn't ask for it, ignore this email.`]],
          signOff: signOff.en,
        };
  },
  invitation: (locale, { companyName, link }) => {
    const url = webLink(link);
    return locale === "ar"
      ? {
          subject: `دعوة للانضمام إلى ${companyName} على ربائد`,
          paragraphs: [[`دُعيت للانضمام إلى ${companyName} على ربائد.`], ["افتح هذا الرابط لقبول الدعوة:"], [{ ltr: url, link: true }], ["يعمل الرابط مرة واحدة وتنتهي صلاحيته."]],
          signOff: signOff.ar,
        }
      : {
          subject: `Join ${companyName} on Rabaed`,
          paragraphs: [[`You're invited to join ${companyName} on Rabaed.`], ["Open this link to accept:"], [{ ltr: url, link: true }], ["The link works once and expires."]],
          signOff: signOff.en,
        };
  },
  "new-device-sign-in": (locale, { when, ip }) =>
    locale === "ar"
      ? {
          subject: "دخول إلى إدارة ربائد من متصفح جديد",
          paragraphs: [
            ["دخل أحدهم إلى إدارة ربائد بحسابك من متصفح لم يُستخدم من قبل، في ", { ltr: when, inline: true }, " من العنوان ", { ltr: ip, inline: true }, "."],
            ["إن لم تكن أنت، غيّر كلمة المرور وأبلغ فريق ربائد فوراً."],
          ],
          signOff: signOff.ar,
        }
      : {
          subject: "New browser signed in to Rabaed Admin",
          paragraphs: [
            ["Someone signed in to Rabaed Admin as you from a browser not used before, at ", { ltr: when, inline: true }, " from ", { ltr: ip, inline: true }, "."],
            ["If it wasn't you, change your password and tell the Rabaed team at once."],
          ],
          signOff: signOff.en,
        },
  "sign-in-locked": (locale, { minutes }) => {
    const count = formatNumber(minutes, locale);
    return locale === "ar"
      ? {
          subject: "أُوقف الدخول إلى إدارة ربائد مؤقتاً",
          paragraphs: [
            [`بعد عدة محاولات دخول فاشلة إلى حسابك في إدارة ربائد، أُوقف الدخول لمدة ${count} ${arabicMinutes(minutes)}.`],
            ["إن لم تكن أنت، أبلغ فريق ربائد فوراً."],
          ],
          signOff: signOff.ar,
        }
      : {
          subject: "Rabaed Admin sign-in locked for now",
          paragraphs: [
            [`After several failed sign-ins to your Rabaed Admin account, sign-in is locked for ${count} minutes.`],
            ["If it wasn't you, tell the Rabaed team at once."],
          ],
          signOff: signOff.en,
        };
  },
};

// Notification emails (RP-357; visibility.md "Notifications and emails", V14).
// The subject is the Document Number, the Subject and what happened, nothing
// else. The body names another Company by name only, and of its people only the
// signer of a final Code; it links to the item.

const notificationCopy = {
  en: {
    reached: (step: string) => `Reached you at ${step}`,
    sentBack: "Sent Back to you",
    vacancy: (step: string) => `Vacancy at ${step}`,
    vacancyHelp: "Whoever held it has left the Project. Name someone to hold it.",
    revision: "New Revision",
    code: (code: string) => `Code ${code}`,
    outcome: {
      passed: "Passed",
      passed_with_comments: "Passed with Comments",
      failed: "Failed",
      approved: "Approved",
      rejected: "Rejected",
      cancelled: "Cancelled",
      closed: "Closed",
    } as Record<string, string>,
    updated: "Updated",
    by: (company: string) => `By ${company}.`,
    signedBy: (name: string) => `Signed by ${name}.`,
    open: "Open it on Rabaed:",
    settings: "You choose which emails you get in your notification settings on Rabaed.",
    digestSubject: "Your Rabaed daily digest",
    digestIntro: "What happened on your items on Rabaed since your last digest:",
  },
  ar: {
    reached: (step: string) => `وصلك في ${step}`,
    sentBack: "أُرجع إليكم",
    vacancy: (step: string) => `شاغر في ${step}`,
    vacancyHelp: "غادر المشروعَ من كان يتولاها. سمِّ من يتولاها.",
    revision: "مراجعة جديدة",
    code: (code: string) => `الرمز ${code}`,
    outcome: {
      passed: "ناجح",
      passed_with_comments: "ناجح مع ملاحظات",
      failed: "راسب",
      approved: "معتمد",
      rejected: "مرفوض",
      cancelled: "ملغى",
      closed: "مغلق",
    } as Record<string, string>,
    updated: "حُدّث",
    by: (company: string) => `من ${company}.`,
    signedBy: (name: string) => `وقّعه ${name}.`,
    open: "افتحه على ربائد:",
    settings: "تختار الرسائل التي تصلك من إعدادات الإشعارات على ربائد.",
    digestSubject: "ملخصك اليومي من ربائد",
    digestIntro: "ما جرى على عناصرك في ربائد منذ آخر ملخص:",
  },
} satisfies Record<Locale, unknown>;

/** What happened on a watched item, in a few words: a Code, a Result, a Transition, a new Revision. */
function watchedHappened(locale: Locale, event: NonNullable<NotificationEmailContent["event"]>): string {
  const copy = notificationCopy[locale];
  if (event.type === "revision_created") return copy.revision;
  if (event.outcome && /^[A-D]$/.test(event.outcome)) return copy.code(event.outcome);
  if (event.outcome && copy.outcome[event.outcome]) return copy.outcome[event.outcome]!;
  if (event.transition) return event.transition[locale];
  return event.type === "cancelled" ? copy.outcome.cancelled! : copy.updated;
}

/** Who did it: the Company by name, and the signer of a final Code (V14). */
function actedBy(locale: Locale, event: NotificationEmailContent["event"]): Paragraph[] {
  const copy = notificationCopy[locale];
  return [
    ...(event?.companyName ? [[copy.by(event.companyName[locale])]] : []),
    ...(event?.signerName ? [[copy.signedBy(event.signerName[locale])]] : []),
  ];
}

const stepName = (locale: Locale, step: BilingualText | null) => step?.[locale] ?? "";

function notificationEmail(locale: Locale, values: NotificationEmailValues, happened: string, details: Paragraph[]): Content {
  const copy = notificationCopy[locale];
  const { documentNumber, subject } = values;
  return {
    subject: [documentNumber && isolate(documentNumber), subject, happened].filter(Boolean).join(" · "),
    paragraphs: [
      documentNumber ? [{ ltr: documentNumber, inline: true }, ` · ${subject}`] : [subject],
      [happened],
      ...details,
      [copy.open],
      [{ ltr: webLink(values.link), link: true }],
      [copy.settings],
    ],
    signOff: signOff[locale],
  };
}

/** What happened, in a few words, for a notification of `kind`: the subject's last part, and a digest entry. */
function happened(locale: Locale, kind: NotificationEmailKind, { step, event }: Pick<NotificationEmailContent, "step" | "event">): string {
  const copy = notificationCopy[locale];
  switch (kind) {
    case "step_reached":
      return copy.reached(stepName(locale, step));
    case "watched_event":
      return event ? watchedHappened(locale, event) : copy.updated;
    case "sent_back":
      return copy.sentBack;
    case "vacancy":
      return copy.vacancy(stepName(locale, step));
  }
}

const notificationTemplates: { [K in NotificationEmailKind as (typeof notificationEmailTemplate)[K]]: Template<NotificationEmailValues> } = {
  "notification-step-reached": (locale, values) => notificationEmail(locale, values, happened(locale, "step_reached", values), []),
  "notification-watched-event": (locale, values) =>
    notificationEmail(locale, values, happened(locale, "watched_event", values), actedBy(locale, values.event)),
  "notification-sent-back": (locale, values) => notificationEmail(locale, values, happened(locale, "sent_back", values), actedBy(locale, values.event)),
  "notification-vacancy": (locale, values) =>
    notificationEmail(locale, values, happened(locale, "vacancy", values), [[notificationCopy[locale].vacancyHelp]]),
};

// The weekly Step Age report (RP-359; visibility.md the Step Age reports row).
// The subject names the report and the recipient's Project only. Each item
// shows its Document Number, Subject, Stage and who holds it: the recipient's
// own Step, or another Company by name only (V14). Ages are only ever weeks at
// a Step, never measured against a date.

const reportCopy = {
  en: {
    subject: (project: string) => `Weekly Step Age report · ${project}`,
    intro: (project: string) => `Your open items on ${project}, by how long each has been at its Step:`,
    group: (weeks: StepAgeReportWeeks, count: number) =>
      `${weeks === 4 ? "4+ weeks" : weeks === 1 ? "1 week" : `${weeks} weeks`} (${formatNumber(count, "en")})`,
    with: (holder: string) => `With ${holder}`,
    oldest: "Open the items 4 weeks or more at their Step:",
    all: "Open all of them on Rabaed:",
    settings: "You can stop this report in your notification settings on Rabaed.",
  },
  ar: {
    subject: (project: string) => `تقرير عمر الخطوة الأسبوعي · ${project}`,
    intro: (project: string) => `بنودك المفتوحة في ${project}، حسب مدة بقاء كل منها في خطوته:`,
    // Arabic counts 3 to 10 with the plural, and 1, 2 apart.
    group: (weeks: StepAgeReportWeeks, count: number) =>
      `${weeks === 4 ? `${formatNumber(4, "ar")}+ أسابيع` : weeks === 3 ? `${formatNumber(3, "ar")} أسابيع` : weeks === 2 ? "أسبوعان" : "أسبوع واحد"} (${formatNumber(count, "ar")})`,
    with: (holder: string) => `لدى ${holder}`,
    oldest: "افتح البنود التي مضى عليها 4 أسابيع أو أكثر في خطوتها:",
    all: "افتحها كلها على ربائد:",
    settings: "يمكنك إيقاف هذا التقرير من إعدادات الإشعارات على ربائد.",
  },
} satisfies Record<Locale, unknown>;

function reportItem(locale: Locale, item: StepAgeReportItem): Paragraph {
  const holder = item.with ? (item.with.kind === "own" ? item.with.step[locale] : item.with.companyName[locale]) : null;
  const rest = [item.subject, item.stage[locale], ...(holder ? [reportCopy[locale].with(holder)] : [])].join(" · ");
  return item.documentNumber ? [{ ltr: item.documentNumber, inline: true }, ` · ${rest}`] : [rest];
}

const reportTemplates: { "step-age-report": Template<StepAgeReportValues> } = {
  "step-age-report": (locale, { projectName, items, link, oldestLink }) => {
    const copy = reportCopy[locale];
    const groups = stepAgeReportGroups(items);
    const hasOldest = groups.some((g) => g.weeks === 4);
    return {
      subject: copy.subject(projectName[locale]),
      paragraphs: [
        [copy.intro(projectName[locale])],
        ...groups.flatMap((g) => [[copy.group(g.weeks, g.items.length)], ...g.items.map((i) => reportItem(locale, i))]),
        ...(hasOldest ? [[copy.oldest], [{ ltr: webLink(oldestLink), link: true }]] : []),
        [copy.all],
        [{ ltr: webLink(link), link: true }],
        [copy.settings],
      ],
      signOff: signOff[locale],
    };
  },
};

// The daily digest (RP-358): one email of the notifications routed to it,
// grouped by Project, then item, each entry as its immediate email would say it
// (V14: another Company by name only). The subject names nothing.
const digestTemplates: { "daily-digest": Template<DailyDigestValues> } = {
  "daily-digest": (locale, { projects }) => {
    const copy = notificationCopy[locale];
    const entryLine = (entry: NotificationDigestItem["entries"][number]): Paragraph => [
      [`– ${happened(locale, entry.kind, entry)}`, ...actedBy(locale, entry.event).map((p) => ` ${p.join("")}`)].join(""),
    ];
    return {
      subject: copy.digestSubject,
      paragraphs: [
        [copy.digestIntro],
        ...projects.flatMap((project) => [
          [project.name[locale]],
          ...project.items.flatMap((item): Paragraph[] => [
            item.documentNumber ? [{ ltr: item.documentNumber, inline: true }, ` · ${item.subject}`] : [item.subject],
            ...item.entries.map(entryLine),
            [{ ltr: webLink(item.link), link: true }],
          ]),
        ]),
        [copy.settings],
      ],
      signOff: signOff[locale],
    };
  },
};

const templates: { [T in EmailTemplate]: Template<EmailTemplateValues[T]> } = {
  ...accountTemplates,
  ...notificationTemplates,
  ...digestTemplates,
  ...reportTemplates,
};

/** Every template, from the templates themselves, so none can be left out of the tests. */
export const emailTemplates = Object.keys(templates) as EmailTemplate[];

// Arabic counts 3 to 10 with the plural, and 11 and up (and 1, 2) with the singular.
function arabicMinutes(count: number): string {
  return count >= 3 && count <= 10 ? "دقائق" : "دقيقة";
}

/** Only web links go in an email; anything else (javascript:, data:) is a bug upstream. */
function webLink(link: string): string {
  const url = new URL(link);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Not a web link: ${url.protocol}`);
  return url.href;
}

/** Keeps a value left to right inside plain text (a subject, the text body): a Unicode left-to-right isolate. */
function isolate(value: string): string {
  return `⁦${value}⁩`;
}

function plain(paragraph: Paragraph): string {
  return paragraph.map((part) => (typeof part === "string" ? part : part.inline ? isolate(part.ltr) : part.ltr)).join("");
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function partHtml(part: Part): string {
  if (typeof part === "string") return escape(part);
  const value = escape(part.ltr);
  if (part.inline) return `<bdi dir="ltr">${value}</bdi>`;
  const inner = part.link ? `<a href="${value}">${value}</a>` : `<strong style="font-size:20px;letter-spacing:2px">${value}</strong>`;
  return `<bdi dir="ltr">${inner}</bdi>`;
}

// Plain markup with inline styles: email clients ignore stylesheets and most CSS.
function page(locale: Locale, content: Content): string {
  const dir = directionOf(locale);
  const paragraphs = content.paragraphs.map((p) => `<p style="margin:0 0 16px">${p.map(partHtml).join("")}</p>`).join("\n");
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><title>${escape(content.subject)}</title></head>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;text-align:${dir === "rtl" ? "right" : "left"}">
${paragraphs}
<p style="margin:24px 0 0">${escape(content.signOff)}</p>
</body>
</html>
`;
}
