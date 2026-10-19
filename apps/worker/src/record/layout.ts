import { formatDate, formatHijriDate, type Locale } from "@rabaed/domain";
import type { RecordBlock, RecordPhoto } from "./form-content.ts";
import type { RecordFonts } from "./fonts.ts";
import { isShortCode, type Chip, type CompanyLine, type FlowMark, type PersonLine, type RecordData } from "./record-data.ts";
import { qrSvg } from "./qr.ts";
import type { RecordLanguage, RecordText } from "./record-text.ts";
import type { WorkingCopyData } from "./working-copy.ts";

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
//
// A Working Copy (RP-621, working-copy.ts) prints the same page from the item as
// shared: the Stage instead of the outcome, the shared moves by Company only, no
// person, no reply, no QR or Verification Code, and the Project's watermark across
// every page and in the footer.

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
  stage: { ar: "المرحلة", en: "Stage" },
  page: { ar: "صفحة", en: "page" },
  of: { ar: "من", en: "of" },
} satisfies Record<string, { ar: string; en: string }>;
type Word = keyof typeof WORDS;

export function recordHtml(data: RecordData | WorkingCopyData, fonts: RecordFonts, images: ReadonlyMap<string, string> = new Map()): string {
  const language: RecordLanguage = data.language;
  /** The sealed record's own parts; null on a Working Copy. */
  const record = "verification" in data ? data : null;
  const copy = "verification" in data ? null : data;
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
  // A Working Copy's footer is its watermark text instead: it is not issued, and has no code.
  const footerWords = { en: copy ? (copy.watermark.en ?? "") : WORDS.footer.en, ar: copy ? (copy.watermark.ar ?? "") : WORDS.footer.ar };
  const english: FooterPart[] = [
    `${LRI}${footerWords.en}${record ? ` · ${record.verification.code}` : ""} · ${WORDS.page.en} `,
    "page",
    ` ${WORDS.of.en} `,
    "pages",
    PDI,
  ];
  const arabicWithCode: FooterPart[] = [
    `${RLI}${footerWords.ar}${record ? ` · ${LRI}${record.verification.code}${PDI}` : ""} · ${WORDS.page.ar} `,
    "page",
    ` ${WORDS.of.ar} `,
    "pages",
    PDI,
  ];
  const arabicPage: FooterPart[] = [`${RLI}${footerWords.ar} · ${WORDS.page.ar} `, "page", ` ${WORDS.of.ar} `, "pages", PDI];
  const footerParts: FooterPart[] =
    language === "en" ? english : language === "ar" ? arabicWithCode : [...english, ` · `, ...arabicPage];
  const footerContent = footerParts.map((p) => (p === "page" ? "counter(page)" : p === "pages" ? "counter(pages)" : cssString(p))).join(" ");

  const person = (p: PersonLine) =>
    `<div class="person"><div class="strong">${txt(p.name)}</div>${p.positions.map((pos) => `<div class="muted">${txt(pos)}</div>`).join("")}<div class="muted">${txt(p.company)}</div></div>`;
  const companyBox = (c: CompanyLine) => `<div class="company"><div class="strong">${txt(c.name)}</div><div class="muted">${txt(c.role)}</div></div>`;

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

  // A Working Copy's moves are by Company only: no Member column and no content hash.
  const flowHead = copy
    ? `<th>#</th><th>${heading("step")}</th><th>${heading("company")}</th><th>${heading("date")}</th><th></th>`
    : `<th>#</th><th>${heading("step")}</th><th>${heading("member")}</th><th>${heading("company")}</th><th>${heading("date")}</th><th></th><th>${heading("hash")}</th>`;
  const moves = (copy?.moves ?? [])
    .map(
      (m, i) => `
        <tr>
          <td class="n">${i + 1}</td>
          <td>${txt(m.label)}</td>
          <td>${txt(m.company)}<div class="muted">${txt(m.role)}</div></td>
          <td>${when(m.at)}</td>
          <td class="markcell">${mark(m.mark)}</td>
        </tr>`,
    )
    .join("");
  const chips = `<div class="chips">${data.chips.map((c) => `<span class="chip${c.issued ? " issued" : ""}">${chipText(c)}</span>`).join("")}</div>`;
  /** The sealed record's Final decision box: the outcome, who issued it, the dates, and the QR with the Verification Code. */
  const decisionBox = (r: RecordData) => `<section class="box">
  <h2>${heading("decision")}</h2>
  <div class="decision">
    <div>
      <div class="outcome">${isShortCode(r.outcome.code) ? ltr(r.outcome.code) : txt(r.outcome.name)}</div>
      ${isShortCode(r.outcome.code) ? `<div>${txt(r.outcome.name)}</div>` : ""}
      ${chips}
      <dl>
        ${r.issuedBy ? `<dt>${heading("issuedBy")}</dt><dd>${person(r.issuedBy)}</dd>` : ""}
        ${r.confirmedBy ? `<dt>${heading("confirmedBy")}</dt><dd>${person(r.confirmedBy)}</dd>` : ""}
        ${r.submittedAt ? `<dt>${heading("submitted")}</dt><dd>${day(r.submittedAt)}</dd>` : ""}
        <dt>${heading("replied")}</dt><dd>${day(r.closedAt)}</dd>
        <dt>${heading("comments")}</dt><dd>${ltr(String(r.reviewComments))}</dd>
      </dl>
    </div>
    <div class="qr">
      ${qrSvg(r.verification.link, 110)}
      <div class="muted">${heading("code")}</div>
      <div class="code">${ltr(r.verification.code)}</div>
      <div class="link">${ltr(r.verification.link)}</div>
    </div>
  </div>
</section>`;
  /** A Working Copy's box in its place: the Stage the item is at, the outcomes it may close with, none issued. */
  const stageBox = (c: WorkingCopyData) => `<section class="box">
  <h2>${heading("stage")}</h2>
  ${c.stage ? `<div class="stage">${txt(c.stage)}</div>` : ""}
  ${chips}
  ${c.submittedAt ? `<dl><dt>${heading("submitted")}</dt><dd>${day(c.submittedAt)}</dd></dl>` : ""}
</section>`;

  const flow = (record?.transitions ?? [])
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
.stage { font-size: 16pt; font-weight: 700; line-height: 1.2; margin-bottom: 1mm; }
/* A Working Copy's watermark: fixed, so Chromium prints it on every page, over the content. */
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); z-index: 10; text-align: center; white-space: nowrap; font-size: 54pt; font-weight: 700; line-height: 1.15; color: rgba(160, 30, 30, 0.16); }
.watermark .en { color: inherit; }
</style>
</head>
<body>
${copy ? `<div class="watermark">${txt(copy.watermark)}</div>` : ""}
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
${record ? decisionBox(record) : stageBox(copy!)}
${
  record?.reply
    ? `<section class="box"><h2>${heading("reply")}</h2><div class="reply"><bdi>${html(record.reply)}</bdi></div></section>`
    : ""
}
<section class="box">
  <h2>${heading("flow")}</h2>
  <table>
    <thead>
      <tr>${flowHead}</tr>
    </thead>
    <tbody>${record ? flow : moves}
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
