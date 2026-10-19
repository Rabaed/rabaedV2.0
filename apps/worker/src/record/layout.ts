import { formatDate, type BilingualText } from "@rabaed/domain";
import type { RecordFonts } from "./fonts.ts";
import type { RecordData } from "./record-data.ts";

// The one Rabaed layout (form-engine.md §6; ADR 0023), printed from the Record
// Data only. This is its bare first version (RP-620): the title block, the
// outcome and the approval flow, in both languages (Arabic headings with their
// English label), Latin digits, Document Numbers left to right, and on every
// page "Issued electronically through Rabaed", the Verification Code and page
// X of Y. RP-151 builds page 1 and the Form, RP-650 the cards, Stamps and
// Comments, RP-147 the appendix; they change this file and LAYOUT_VERSION.

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Left to right whatever surrounds it: Document Numbers, codes, hashes, links. */
const ltr = (s: string) => `<bdi dir="ltr" class="ltr">${html(s)}</bdi>`;

/** Arabic, then English on its own line when it differs, so a wrapped line never mixes the two. */
const both = (t: BilingualText) =>
  t.ar === t.en
    ? `<span lang="ar">${html(t.ar)}</span>`
    : `<span lang="ar" class="line">${html(t.ar)}</span><span class="line en"><bdi lang="en" dir="ltr">${html(t.en)}</bdi></span>`;

/** An Arabic heading with its English label beside it. */
const heading = (ar: string, en: string) => `<span lang="ar">${ar}</span> <span lang="en" dir="ltr" class="en">${en}</span>`;

const when = (iso: string) => {
  const at = new Date(iso);
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  return `<span dir="ltr">${html(formatDate(at, "en", options))}</span><br><span lang="ar">${html(formatDate(at, "ar", options))}</span>`;
};

/** The CSS string of `s`, for `content:` in @page. */
const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function recordHtml(data: RecordData, fonts: RecordFonts): string {
  const number = data.documentNumber ?? "—";
  const revision = data.revisionNo > 0 ? ` (Rev ${data.revisionNo})` : "";
  const footer = `Issued electronically through Rabaed · صادر إلكترونيًا عبر رابد · Verification Code ${data.verification.code}`;
  const rows = data.transitions
    .map(
      (t, i) => `
        <tr>
          <td class="n">${i + 1}</td>
          <td>${both(t.label)}</td>
          <td>${both(t.memberName)}${t.positions.map((p) => `<div class="muted">${both(p)}</div>`).join("")}</td>
          <td>${both(t.companyName)}</td>
          <td>${when(t.at)}</td>
          <td class="hash">${t.contentSha256 ? ltr(t.contentSha256) : ""}</td>
        </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${html(`${data.type.code} ${number}`)}</title>
<style>
${fonts.css}
@page {
  size: A4;
  margin: 18mm 14mm 20mm 14mm;
  @bottom-center {
    content: ${cssString(footer)} " · " counter(page) " / " counter(pages);
    font-family: ${fonts.family};
    font-size: 8pt;
    color: #444;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: ${fonts.family}; font-size: 9.5pt; line-height: 1.45; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.en { color: #444; }
.line { display: block; }
.muted { color: #555; font-size: 8.5pt; }
.title-block { border-bottom: 2px solid #111; padding-bottom: 6mm; margin-bottom: 6mm; }
h1 { font-size: 16pt; margin: 0 0 2mm; }
h2 { font-size: 11pt; margin: 6mm 0 2mm; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 1.5mm 6mm; margin: 0; }
dt { color: #444; }
dd { margin: 0; }
.outcome { font-size: 20pt; font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.5pt solid #999; padding: 1.5mm 2mm; vertical-align: top; text-align: start; }
th { background: #eee; font-weight: 700; }
td.n { width: 6mm; text-align: center; }
td.hash { font-size: 7pt; word-break: break-all; width: 34mm; }
tr { break-inside: avoid; }
</style>
</head>
<body>
<section class="title-block">
  <h1>${both(data.type.name)} ${ltr(data.type.code)}</h1>
  <dl>
    <dt>${heading("المشروع", "Project")}</dt><dd>${both(data.projectName)}</dd>
    <dt>${heading("الموضوع", "Subject")}</dt><dd><bdi>${html(data.subject)}</bdi></dd>
    <dt>${heading("رقم المستند", "Document Number")}</dt><dd>${ltr(number + revision)}</dd>
  </dl>
</section>
<section>
  <h2>${heading("القرار النهائي", "Final decision")}</h2>
  <dl>
    <dt>${heading("النتيجة", "Outcome")}</dt><dd class="outcome">${ltr(data.outcome)}</dd>
    <dt>${heading("تاريخ الإغلاق", "Closed")}</dt><dd>${when(data.closedAt)}</dd>
    <dt>${heading("رمز التحقق", "Verification Code")}</dt><dd>${ltr(data.verification.code)}</dd>
    <dt>${heading("رابط التحقق", "Verification link")}</dt><dd>${ltr(data.verification.link)}</dd>
  </dl>
</section>
<section>
  <h2>${heading("مسار الاعتماد", "Approval flow")}</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>${heading("الإجراء", "Transition")}</th>
        <th>${heading("العضو", "Member")}</th>
        <th>${heading("الشركة", "Company")}</th>
        <th>${heading("التاريخ", "Date")}</th>
        <th>${heading("بصمة المحتوى", "Content hash")}</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</section>
</body>
</html>`;
}
