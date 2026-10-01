import { directionOf, formatNumber, type Locale } from "@rabaed/domain";

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
}

export type EmailTemplate = keyof EmailTemplateValues;

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

const templates: { [T in EmailTemplate]: (locale: Locale, values: EmailTemplateValues[T]) => Content } = {
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

function plain(paragraph: Paragraph): string {
  return paragraph.map((part) => (typeof part === "string" ? part : part.ltr)).join("");
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
