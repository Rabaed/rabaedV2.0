import { formatDate, formatHijriDate, type Locale } from "@rabaed/domain";
import type { RecordBlock, RecordPhoto } from "./form-content.ts";
import type { RecordFonts } from "./fonts.ts";
import { isShortCode, REPLACED, type Chip, type CompanyLine, type FlowMark, type PersonLine, type RecordData } from "./record-data.ts";
import { qrSvg } from "./qr.ts";
import { texts, type RecordLanguage, type RecordText } from "./record-text.ts";

// The one Rabaed layout (form-engine.md §6; ADR 0023), printed from the Record
// Data only. Page 1 is the Companies, the title block, the Parties and
// Classification boxes, the Final decision box (outcome, chips, who issued it,
// dates, Review Comments, the QR and Verification Code), the reply's first
// lines and the approval flow; the Form's sections and the shared Documents
// follow. With record language `bilingual` headings are Arabic with their
// English label, as in the owner's samples; `ar` and `en` print one language.
// Latin digits, Document Numbers left to right, and on every page "Issued
// electronically through Rabaed", the Verification Code and page X of Y.
// RP-650 adds the cards, Stamps and Comments, RP-147 the appendix; they change
// this file and LAYOUT_VERSION.

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Left to right whatever surrounds it: Document Numbers, codes, hashes, links. */
const ltr = (s: string) => `<bdi dir="ltr" class="ltr">${html(s)}</bdi>`;

/** Text in the record's languages: Arabic, then English on its own line when it differs, so a wrapped line never mixes the two. */
function txt(t: RecordText): string {
  if (t.ar !== undefined && t.en !== undefined) {
    // The same in both: a typed value, which reads in its own direction (a Latin unit after its number stays after it).
    return t.ar === t.en
      ? `<bdi lang="ar">${html(t.ar)}</bdi>`
      : `<span lang="ar" class="line">${html(t.ar)}</span><span class="line en"><bdi lang="en" dir="ltr">${html(t.en)}</bdi></span>`;
  }
  if (t.ar !== undefined) return `<bdi lang="ar">${html(t.ar)}</bdi>`;
  return `<bdi lang="en" dir="ltr">${html(t.en ?? "")}</bdi>`;
}

/** The text on one line, for a list of names. */
function inline(t: RecordText): string {
  return t.ar !== undefined && t.en !== undefined && t.ar !== t.en ? `${txt({ ar: t.ar })} · ${txt({ en: t.en })}` : txt(t);
}

const WORDS = {
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
} satisfies Record<string, { ar: string; en: string }>;
type Word = keyof typeof WORDS;

/**
 * Where a probe render stops (pages.ts): before the Review Comments, or before or after one
 * Signature card. Nothing after it is drawn, so its page count says where that part falls.
 */
export type RecordCut = { readonly beforeComments: true } | { readonly card: number; readonly withCard: boolean };

export function recordHtml(data: RecordData, fonts: RecordFonts, images: ReadonlyMap<string, string> = new Map(), cut?: RecordCut): string {
  const language: RecordLanguage = data.language;
  const locales: Locale[] = language === "bilingual" ? ["ar", "en"] : [language];

  /** An Arabic heading with its English label beside it (bilingual), or one language. */
  const heading = (word: Word) => {
    const w = WORDS[word];
    return language === "ar"
      ? `<span lang="ar">${w.ar}</span>`
      : language === "en"
        ? `<span lang="en" dir="ltr">${w.en}</span>`
        : `<span lang="ar">${w.ar}</span> <span lang="en" dir="ltr" class="en">${w.en}</span>`;
  };

  /** The language of dates in fields: the record's, or English when it prints both. */
  const primary: Locale = language === "ar" ? "ar" : "en";
  const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");

  /** A date in `l` (Gregorian, Latin digits), with the Hijri date beside it when the Project turns it on. */
  const dateText = (iso: string, l: Locale, withTime: boolean) => {
    const at = new Date(iso);
    const gregorian = formatDate(at, l, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
    const hijri = data.hijri ? ` <bdi dir="${dirOf(l)}" lang="${l}" class="hijri">(${html(formatHijriDate(at, l))})</bdi>` : "";
    return `<bdi dir="${dirOf(l)}" lang="${l}">${html(gregorian)}</bdi>${hijri}`;
  };
  /** One date next to its label, not one line for each language. */
  const day = (iso: string) => dateText(iso, primary, false);
  const when = (iso: string) => dateText(iso, primary, true);

  const number = data.documentNumber ?? "—";
  const numberLine = data.revisionNo > 0 ? `${number} Rev ${data.revisionNo}` : number;
  // One line on every page: "Issued electronically through Rabaed · code · page X of Y", with the Arabic
  // beside it in a bilingual record. The code is printed once; each part is bidi-isolated, so the order holds.
  const LRI = "\u2066";
  const RLI = "\u2067";
  const PDI = "\u2069";
  type FooterPart = string | "page" | "pages";
  const english: FooterPart[] = [`${LRI}${WORDS.footer.en} · ${data.verification.code} · ${WORDS.page.en} `, "page", ` ${WORDS.of.en} `, "pages", PDI];
  const arabicWithCode: FooterPart[] = [
    `${RLI}${WORDS.footer.ar} · ${LRI}${data.verification.code}${PDI} · ${WORDS.page.ar} `,
    "page",
    ` ${WORDS.of.ar} `,
    "pages",
    PDI,
  ];
  const arabicPage: FooterPart[] = [`${RLI}${WORDS.footer.ar} · ${WORDS.page.ar} `, "page", ` ${WORDS.of.ar} `, "pages", PDI];
  const footerParts: FooterPart[] =
    language === "en" ? english : language === "ar" ? arabicWithCode : [...english, ` · `, ...arabicPage];
  const footerContent = footerParts.map((p) => (p === "page" ? "counter(page)" : p === "pages" ? "counter(pages)" : cssString(p))).join(" ");

  const person = (p: PersonLine) =>
    `<div class="person"><div class="strong">${txt(p.name)}</div>${p.positions.map((pos) => `<div class="muted">${txt(pos)}</div>`).join("")}<div class="muted">${txt(p.company)}</div></div>`;
  const companyBox = (c: CompanyLine) => {
    const logo = c.logoKey ? images.get(c.logoKey) : undefined;
    return `<div class="company">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div class="strong">${txt(c.name)}</div><div class="muted">${txt(c.role)}</div></div>`;
  };

  const mark = (m: FlowMark) => {
    const paths: Record<FlowMark, string> = {
      done: '<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="#1d7a46" stroke-width="2"/>',
      revise: '<path d="M4 6h6a3 3 0 010 6H5M4 6l2.5-2.5M4 6l2.5 2.5" fill="none" stroke="#a15c00" stroke-width="1.8"/>',
      rejected: '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="#b3261e" stroke-width="2"/>',
    };
    return `<svg class="mark" viewBox="0 0 16 16" width="14" height="14" role="img">${paths[m]}</svg>`;
  };
  const check = '<svg class="mark" viewBox="0 0 16 16" width="11" height="11" role="img"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="#111" stroke-width="2.4"/></svg>';

  const chipText = (c: Chip) => (isShortCode(c.code) ? ltr(c.code) : txt(c.name));
  const outcomeLarge = isShortCode(data.outcome.code) ? ltr(data.outcome.code) : txt(data.outcome.name);

  const photo = (p: RecordPhoto) => {
    const image = images.get(p.storageKey);
    return `<figure class="photo">${image ? `<img src="${image}" alt="">` : '<div class="noimage"></div>'}<figcaption><bdi dir="ltr">${html(p.fileName)}</bdi>${
      p.takenAt ? `<div class="muted">${heading("takenAt")}: ${when(p.takenAt)}</div>` : ""
    }</figcaption></figure>`;
  };

  /** A table, checklist or photo grid: it takes the whole width. */
  function standalone(b: Exclude<RecordBlock, { kind: "field" }>): string {
    switch (b.kind) {
      case "table":
        return `<div class="tablewrap"><div class="tlabel">${txt(b.label)}</div><table><thead><tr>${b.columns.map((c) => `<th>${txt(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${txt(cell)}</td>`).join("")}</tr>`)
          .join("")}${
          b.totals ? `<tr class="totals">${b.totals.map((cell, i) => `<td>${i === 0 && !hasText(cell) ? heading("totals") : txt(cell)}</td>`).join("")}</tr>` : ""
        }</tbody></table></div>`;
      case "checklist":
        return `<div class="tablewrap"><div class="tlabel">${txt(b.label)} <span class="muted">· ${txt(b.summary)}</span></div><table><tbody>${b.items
          .map(
            (item) =>
              `<tr><td>${txt(item.text)}${item.comment ? `<div class="muted"><bdi>${html(item.comment)}</bdi></div>` : ""}${
                item.photos.length > 0 ? `<div class="photos">${item.photos.map(photo).join("")}</div>` : ""
              }</td><td class="answer">${txt(item.answer)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`;
      case "photos":
        return `<div class="tablewrap"><div class="tlabel">${txt(b.label)}</div><div class="photos">${b.photos.map(photo).join("")}</div></div>`;
    }
  }
  /** Fields as a label and value grid; tables, checklists and photos between them at full width. */
  function blocks(list: readonly RecordBlock[]): string {
    const out: string[] = [];
    let fields: string[] = [];
    const flush = () => {
      if (fields.length > 0) out.push(`<dl class="grid">${fields.join("")}</dl>`);
      fields = [];
    };
    for (const b of list) {
      if (b.kind === "field") fields.push(`<dt>${txt(b.label)}</dt><dd>${txt(b.value)}</dd>`);
      else {
        flush();
        out.push(standalone(b));
      }
    }
    flush();
    return out.join("");
  }

  const flow = data.transitions
    .map(
      (t, i) => `
        <tr>
          <td class="n">${i + 1}</td>
          <td>${txt(t.label)}</td>
          <td>${txt(t.name)}${t.positions.map((p) => `<div class="muted">${txt(p)}</div>`).join("")}</td>
          <td>${txt(t.company)}<div class="muted">${txt(t.role)}</div></td>
          <td>${when(t.at)}</td>
          <td class="markcell">${mark(t.mark)}</td>
          <td class="hash">${t.contentSha256 ? ltr(t.contentSha256) : ""}</td>
        </tr>`,
    )
    .join("");

  // Each language's sentence on a line of its own, so a wrapped line never mixes the two.
  const revisionLine = data.revisionOf
    ? `<div class="revision">${locales
        .map(
          (l) =>
            `<div class="line" lang="${l}" dir="${dirOf(l)}">${WORDS.revisionOf[l]} ${ltr(data.revisionOf!.documentNumber)}, ${WORDS.closedAtCode[l]} ${html(data.revisionOf!.outcome)} ${WORDS.closedOn[l]} ${dateText(data.revisionOf!.closedAt, l, false)}</div>`,
        )
        .join("")}</div>`
    : "";

  // The running header on every page after the first: the Type badge, the Subject, the Document
  // Number and Revision, the outcome badge. Each part bidi-isolated, as in the footer.
  const FSI = "\u2068";
  const outcomeBadge = isShortCode(data.outcome.code) ? `${LRI}${data.outcome.code}${PDI}` : texts(data.outcome.name).map((n) => `${FSI}${n}${PDI}`).join(" / ");
  const headerContent = cssString(`${LRI}${data.type.code}${PDI}  ·  ${FSI}${data.subject}${PDI}  ·  ${LRI}${numberLine}${PDI}  ·  ${outcomeBadge}`);

  const image = (key: string | null | undefined, cls: string) => {
    const src = key ? images.get(key) : undefined;
    return src ? `<img class="${cls}" src="${src}" alt="">` : "";
  };
  /** A sentence in each of the record's languages, each on its own line. */
  const sentence = (fn: (l: Locale) => string) => locales.map((l) => `<div class="line" lang="${l}" dir="${dirOf(l)}">${fn(l)}</div>`).join("");

  const cancellation = data.cancellation
    ? data.cancellation.companyLeft
      ? `<dt></dt><dd>${sentence((l) => `${WORDS.byRabaed[l]} ${html(data.cancellation!.companyLeft![l] ?? "")} ${WORDS.leftProject[l]}`)}</dd>`
      : `${data.cancellation.by ? `<dt>${heading("cancelledBy")}</dt><dd>${person(data.cancellation.by)}</dd>` : ""}${
          data.cancellation.reason ? `<dt>${heading("reason")}</dt><dd class="pre"><bdi>${html(data.cancellation.reason)}</bdi></dd>` : ""
        }`
    : "";

  const commentsPart =
    data.comments.length === 0 || (cut !== undefined && "beforeComments" in cut)
      ? ""
      : `<section class="after-start comments"><h2 class="part">${heading("reviewComments")}</h2>${data.comments
          .map(
            (g) => `<div class="author">
  <div class="avatar">${txt(g.initials)}</div>
  <div>${person(g.author)}<div class="muted">${when(g.at)}</div></div>
</div>
<ol class="review-items">${g.items
              .map(
                (c) =>
                  `<li value="${c.n}"><span class="n">${c.n}.</span><div><div class="pre"><bdi>${html(c.comment)}</bdi></div>${
                    c.reference ? `<div class="muted">${heading("reference")}: <bdi>${html(c.reference)}</bdi></div>` : ""
                  }${c.documentNumber ? `<div class="muted">${ltr(c.documentNumber)}</div>` : ""}</div></li>`,
              )
              .join("")}</ol>`,
          )
          .join("")}</section>`;

  const cardHtml = (c: RecordData["cards"][number], i: number) => `<article class="card">
  <div class="card-head"><span class="num">${i + 1}</span> <span class="strong">${txt(c.verb)}</span>${i === 0 ? "" : ` <span class="muted">· ${txt(c.label)}</span>`}</div>
  <div class="card-body">
    <div>${person(c)}<div class="muted">${when(c.at)}</div></div>
    <div class="sigbox">${image(c.signatureKey, "sig")}<div class="muted">${heading("signature")}</div></div>
  </div>
  ${c.lines
    .map((line) =>
      line.kind === "text"
        ? `<div class="answer"><div class="alabel">${txt(line.label)}</div><div class="pre">${txt(line.value)}</div></div>`
        : `<div class="answer"><div class="alabel">${txt(line.label)}</div><ol class="numbered">${line.items.map((item, n) => `<li><span class="n">${n + 1}.</span><div>${txt(item)}</div></li>`).join("")}</ol></div>`,
    )
    .join("")}
</article>`;
  const cardsShown = cut === undefined ? data.cards : "beforeComments" in cut ? [] : data.cards.slice(0, cut.card + (cut.withCard ? 1 : 0));
  const signaturesPart =
    cut !== undefined && "beforeComments" in cut
      ? ""
      : `<section class="${data.comments.length === 0 ? "after-start " : ""}signatures"><h2 class="part">${heading("signatures")}</h2>${cardsShown.map(cardHtml).join("")}</section>`;
  const ended = cut === undefined;
  const nextStepPart =
    ended && data.nextStep
      ? `<section class="box next"><h2>${heading("nextStep")}</h2>${
          data.nextStep.kind === "revision"
            ? sentence((l) => `${WORDS.revision[l]} ${ltr(String((data.nextStep as { revisionNo: number }).revisionNo))}${l === "ar" ? "،" : ","} ${WORDS.by[l]} ${html((data.nextStep as { company: RecordText }).company[l] ?? "")}`)
            : sentence((l) => html(REPLACED[l]))
        }</section>`
      : "";
  const stampsPart =
    ended && data.stamps.length > 0
      ? `<section class="box"><h2>${heading("stamps")}</h2><div class="stamps">${data.stamps
          .map((s) => `<figure class="stamp">${image(s.stampKey, "stampimg") || '<div class="nostamp"></div>'}<figcaption><div class="strong">${txt(s.role)}</div><div class="muted">${txt(s.company)}</div></figcaption></figure>`)
          .join("")}</div></section>`
      : "";
  const disclaimerPart = ended && data.disclaimer ? `<section class="box disclaimer"><h2>${heading("disclaimer")}</h2><div class="pre">${txt(data.disclaimer)}</div></section>` : "";
  const after = `${commentsPart}${signaturesPart}${nextStepPart}${stampsPart}${disclaimerPart}`;

  const dir = language === "en" ? "ltr" : "rtl";
  return `<!doctype html>
<html lang="${language === "en" ? "en" : "ar"}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${html(`${data.type.code} ${number}`)}</title>
<style>
${fonts.css}
@page {
  size: A4;
  margin: 16mm 13mm 20mm 13mm;
  @bottom-center {
    content: ${footerContent};
    font-family: ${fonts.family};
    font-size: 7.5pt;
    color: #444;
  }
  @top-center {
    content: ${headerContent};
    font-family: ${fonts.family};
    font-size: 8pt;
    color: #222;
    border-bottom: 0.75pt solid #999;
    vertical-align: bottom;
    padding-bottom: 1.5mm;
  }
}
@page :first {
  @top-center { content: none; border: none; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: ${fonts.family}; font-size: 9pt; line-height: 1.4; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.en { color: #444; }
.line { display: block; }
.strong { font-weight: 700; }
.muted { color: #555; font-size: 8pt; }
.hijri { color: #555; font-size: 8pt; }
.box { border: 0.75pt solid #777; border-radius: 1.5mm; padding: 3mm 4mm; margin-bottom: 4mm; break-inside: avoid; }
.box > h2 { font-size: 9.5pt; margin: -3mm -4mm 3mm; padding: 1.6mm 4mm; background: #eee; border-bottom: 0.75pt solid #777; border-radius: 1.5mm 1.5mm 0 0; }
.companies { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 4mm; break-inside: avoid; }
.company { flex: 1 1 40mm; border: 0.75pt solid #999; border-radius: 1.5mm; padding: 2mm 3mm; min-height: 12mm; }
.title-block { border-bottom: 2px solid #111; padding-bottom: 4mm; margin-bottom: 4mm; break-inside: avoid; }
h1 { font-size: 15pt; margin: 0 0 2mm; }
.badge { display: inline-block; border: 0.75pt solid #111; border-radius: 1mm; padding: 0 2mm; font-size: 10pt; margin-inline-start: 2mm; }
.revision { margin-top: 2mm; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.two > .box { margin-bottom: 4mm; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 1.2mm 5mm; margin: 0; }
dl.grid { grid-template-columns: max-content 1fr max-content 1fr; margin-bottom: 2mm; }
dt { color: #444; }
dd { margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 1.5mm; margin: 1.5mm 0; }
.chip { border: 0.75pt solid #999; border-radius: 1mm; padding: 0.4mm 2.2mm; color: #444; }
.chip.issued { border-color: #111; background: #111; color: #fff; font-weight: 700; }
.trades { display: flex; flex-wrap: wrap; gap: 1.2mm; margin-bottom: 2mm; }
.trade { border: 0.5pt solid #aaa; border-radius: 1mm; padding: 0.2mm 1.8mm; color: #555; }
.trade.selected { border: 0.75pt solid #111; color: #111; font-weight: 700; }
.decision { display: grid; grid-template-columns: 1fr auto; gap: 5mm; align-items: start; }
.outcome { font-size: 26pt; font-weight: 700; line-height: 1.1; }
.qr { text-align: center; }
.qr svg { display: block; margin: 0 auto 1mm; }
.qr .code { font-weight: 700; font-size: 10pt; letter-spacing: 0.5pt; }
.qr .link { font-size: 5.5pt; color: #555; max-width: 40mm; word-break: break-all; }
.reply { white-space: pre-line; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.5pt solid #999; padding: 1.3mm 2mm; vertical-align: top; text-align: start; }
th { background: #eee; font-weight: 700; }
td.n { width: 6mm; text-align: center; }
td.markcell { width: 9mm; text-align: center; }
td.answer { width: 28mm; }
td.hash { font-size: 6pt; word-break: break-all; width: 30mm; }
tr { break-inside: avoid; }
.totals td { font-weight: 700; background: #f6f6f6; }
section.form { margin-top: 2mm; }
section.form > h2 { font-size: 11pt; margin: 5mm 0 2mm; border-bottom: 1pt solid #111; padding-bottom: 1mm; }
.tablewrap { grid-column: 1 / -1; margin: 2mm 0; }
.tlabel { font-weight: 700; margin-bottom: 1mm; }
.photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 1.5mm; }
.photo { margin: 0; break-inside: avoid; font-size: 7.5pt; }
.photo img { width: 100%; max-height: 45mm; object-fit: cover; border: 0.5pt solid #999; display: block; }
.photo .noimage { height: 20mm; border: 0.5pt dashed #999; }
.mark { vertical-align: middle; }
.pre { white-space: pre-line; }
.logo { display: block; max-height: 12mm; max-width: 40mm; margin-bottom: 1.5mm; }
.pointer { margin-top: 1.5mm; }
.after-start { break-before: page; }
h2.part { font-size: 12pt; margin: 0 0 3mm; border-bottom: 1.5pt solid #111; padding-bottom: 1mm; }
.signatures, .comments { margin-bottom: 4mm; }
.author { display: flex; gap: 3mm; align-items: center; margin: 3mm 0 2mm; break-after: avoid; }
.avatar { width: 10mm; height: 10mm; border-radius: 50%; background: #111; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 9pt; flex: none; }
ol.review-items, ol.numbered { list-style: none; margin: 0 0 3mm; padding: 0; }
ol.review-items > li, ol.numbered > li { display: flex; gap: 2mm; padding: 1.2mm 0; border-bottom: 0.5pt solid #ddd; break-inside: avoid; }
ol.numbered > li { border-bottom: none; padding: 0.4mm 0; }
li > .n { font-weight: 700; min-width: 6mm; }
.card { border: 0.75pt solid #777; border-radius: 1.5mm; padding: 2.5mm 4mm; margin-bottom: 3mm; break-inside: avoid; }
.card > .card-head { border-bottom: 0.5pt solid #ccc; padding-bottom: 1.2mm; margin-bottom: 2mm; }
.card .num { display: inline-block; min-width: 5mm; height: 5mm; border-radius: 1mm; background: #111; color: #fff; text-align: center; font-weight: 700; font-size: 8pt; }
.card-body { display: grid; grid-template-columns: 1fr 48mm; gap: 4mm; align-items: start; }
.sigbox { text-align: center; border-bottom: 0.75pt solid #111; min-height: 18mm; display: flex; flex-direction: column; justify-content: flex-end; }
.sig { max-height: 16mm; max-width: 46mm; margin: 0 auto; display: block; }
.answer { margin-top: 2mm; }
.alabel { color: #444; font-weight: 700; font-size: 8pt; }
.stamps { display: flex; flex-wrap: wrap; gap: 5mm; }
.stamp { margin: 0; width: 38mm; text-align: center; break-inside: avoid; }
.stampimg { max-width: 32mm; max-height: 32mm; display: block; margin: 0 auto 1.5mm; }
.nostamp { height: 32mm; }
.disclaimer .pre { font-size: 8pt; color: #333; }
</style>
</head>
<body>
<div class="companies">${data.companies.map(companyBox).join("")}</div>
<section class="title-block">
  <h1>${txt(data.type.name)} <span class="badge">${ltr(data.type.code)}</span></h1>
  <dl>
    <dt>${heading("subject")}</dt><dd><bdi>${html(data.subject)}</bdi></dd>
    <dt>${heading("number")}</dt><dd>${ltr(numberLine)}</dd>
  </dl>
  ${revisionLine}
</section>
<div class="two">
  <section class="box">
    <h2>${heading("parties")}</h2>
    <dl>
      <dt>${heading("project")}</dt><dd>${txt(data.projectName)}</dd>
      ${data.parties.map((c) => `<dt>${txt(c.role)}</dt><dd>${txt(c.name)}</dd>`).join("")}
    </dl>
  </section>
  <section class="box">
    <h2>${heading("classification")}</h2>
    <div class="trades">${data.trades.map((t) => `<span class="trade${t.selected ? " selected" : ""}">${t.selected ? check : ""} ${inline(t.name)}</span>`).join("")}</div>
    <dl>
      ${data.location.length > 0 ? `<dt>${heading("location")}</dt><dd>${data.location.map(inline).join(" › ")}</dd>` : ""}
      ${data.scopes.length > 0 ? `<dt>${heading("scopes")}</dt><dd>${data.scopes.map(inline).join("، ")}</dd>` : ""}
    </dl>
    ${data.classification.length > 0 ? blocks(data.classification) : ""}
  </section>
</div>
<section class="box">
  <h2>${heading("decision")}</h2>
  <div class="decision">
    <div>
      <div class="outcome">${outcomeLarge}</div>
      ${isShortCode(data.outcome.code) ? `<div>${txt(data.outcome.name)}</div>` : ""}
      <div class="chips">${data.chips.map((c) => `<span class="chip${c.issued ? " issued" : ""}">${chipText(c)}</span>`).join("")}</div>
      <dl>
        ${data.issuedBy ? `<dt>${heading("issuedBy")}</dt><dd>${person(data.issuedBy)}</dd>` : ""}
        ${data.confirmedBy ? `<dt>${heading("confirmedBy")}</dt><dd>${person(data.confirmedBy)}</dd>` : ""}
        ${data.submittedAt ? `<dt>${heading("submitted")}</dt><dd>${day(data.submittedAt)}</dd>` : ""}
        <dt>${heading("replied")}</dt><dd>${day(data.closedAt)}</dd>
        ${data.reviewDays !== null ? `<dt>${heading("reviewDuration")}</dt><dd>${ltr(String(data.reviewDays))}</dd>` : ""}
        <dt>${heading("comments")}</dt><dd>${ltr(String(data.reviewComments))}${
          data.pages.comments !== null && data.comments.length > 0 ? ` <span class="muted">· ${heading("page")} ${ltr(String(data.pages.comments))}</span>` : ""
        }</dd>
        ${cancellation}
      </dl>
    </div>
    <div class="qr">
      ${qrSvg(data.verification.link, 110)}
      <div class="muted">${heading("code")}</div>
      <div class="code">${ltr(data.verification.code)}</div>
      <div class="link">${ltr(data.verification.link)}</div>
    </div>
  </div>
</section>
${
  data.reply
    ? `<section class="box"><h2>${heading("reply")}</h2><div class="reply"><bdi>${html(data.reply)}</bdi></div>${
        data.pages.reply !== null ? `<div class="pointer muted">${heading("fullText")} ${ltr(String(data.pages.reply))}</div>` : ""
      }</section>`
    : ""
}
<section class="box">
  <h2>${heading("flow")}</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>${heading("step")}</th>
        <th>${heading("member")}</th>
        <th>${heading("company")}</th>
        <th>${heading("date")}</th>
        <th></th>
        <th>${heading("hash")}</th>
      </tr>
    </thead>
    <tbody>${flow}
    </tbody>
  </table>
</section>
${data.sections
  .map((s) => `<section class="form"><h2>${txt(s.title)}</h2>${blocks(s.blocks)}</section>`)
  .join("")}
${
  data.documents.length > 0
    ? `<section class="form"><h2>${heading("documents")}</h2><table><thead><tr><th>${heading("documentName")}</th><th>${heading("pages")}</th></tr></thead><tbody>${data.documents
        .map((d) => `<tr><td><bdi dir="ltr">${html(d.fileName)}</bdi></td><td class="n">${d.pages === null ? "—" : ltr(String(d.pages))}</td></tr>`)
        .join("")}</tbody></table></section>`
    : ""
}
${after}
</body>
</html>`;
}

/** The CSS string of `s`, for `content:` in @page. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Whether a text has anything to print. */
function hasText(t: RecordText): boolean {
  return (t.ar ?? "") !== "" || (t.en ?? "") !== "";
}
