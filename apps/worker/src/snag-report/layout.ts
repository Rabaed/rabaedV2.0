import { formatDate, intlLocaleOf, type BilingualText, type Locale, type SnagReportContent, type SnagReportItem } from "@rabaed/domain";
import type { RecordFonts } from "../record/fonts.ts";

// The Snag report's layout (RP-677; ADR 0023): HTML and CSS that the Documental Record's Chromium
// renderer prints, in one language as the viewer reads (Arabic right to left), with Latin digits and
// Document Numbers left to right. A plain PDF: not PDF/A-3, not sealed, not a Record. Each item shows
// its number, Subject, Type, Trade, Location, Stage, who it is with, its Step Age in weeks and its
// first photo where the viewer sees one. Step Age only; no due date, deadline or "overdue".

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Left to right whatever surrounds it: a Document Number. */
const ltr = (s: string) => `<bdi dir="ltr" class="ltr">${html(s)}</bdi>`;

const WORDS = {
  title: { en: "Snag List", ar: "قائمة الملاحظات" },
  project: { en: "Project", ar: "المشروع" },
  items: { en: "Items", ar: "العناصر" },
  type: { en: "Type", ar: "النوع" },
  trade: { en: "Trade", ar: "التخصص" },
  location: { en: "Location", ar: "الموقع" },
  stage: { en: "Stage", ar: "المرحلة" },
  with: { en: "With", ar: "لدى" },
  stepAge: { en: "Step Age", ar: "عمر الخطوة" },
  noNumber: { en: "No number yet", ar: "بلا رقم بعد" },
  capped: {
    en: "The list stops here; narrow the filters to include the rest.",
    ar: "تتوقف القائمة هنا؛ ضيّق عوامل التصفية لتشمل الباقي.",
  },
  footer: { en: "Snag List · Rabaed", ar: "قائمة الملاحظات · رابد" },
  page: { en: "page", ar: "صفحة" },
  of: { en: "of", ar: "من" },
} satisfies Record<string, BilingualText>;

/** "3 weeks" / "3 أسابيع": Latin digits, the plural the language needs. */
function weeks(n: number, locale: Locale): string {
  if (locale === "en") return `${n} ${n === 1 ? "week" : "weeks"}`;
  const form = new Intl.PluralRules(intlLocaleOf(locale)).select(n);
  const word = form === "one" ? "أسبوع" : form === "two" ? "أسبوعان" : form === "few" ? "أسابيع" : "أسبوعًا";
  return form === "two" ? word : `${n} ${word}`;
}

const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The report as a page. `images` holds the data URL of each photo by storage key (the job read them, within its
 * limits); a photo not in it is left out. `at` is when the report was made.
 */
export function snagReportHtml(
  content: SnagReportContent,
  locale: Locale,
  fonts: RecordFonts,
  images: ReadonlyMap<string, string>,
  at: Date,
): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const word = (w: keyof typeof WORDS) => WORDS[w][locale];
  const text = (t: BilingualText) => `<bdi lang="${locale}" dir="${dir}">${html(t[locale])}</bdi>`;
  const field = (label: string, value: string) => `<div class="field"><span class="label">${html(label)}</span><span class="value">${value}</span></div>`;

  const card = (i: SnagReportItem) => {
    const photo = i.photo ? images.get(i.photo.storageKey) : undefined;
    return `<section class="item">
  <div class="body">
    <div class="head">${i.documentNumber ? ltr(i.documentNumber) : `<span class="muted">${html(word("noNumber"))}</span>`}</div>
    <h2><bdi lang="${locale}" dir="auto">${html(i.subject)}</bdi></h2>
    <div class="fields">
      ${field(word("type"), text(i.type))}
      ${field(word("trade"), text(i.trade))}
      ${i.location ? field(word("location"), text(i.location)) : ""}
      ${field(word("stage"), text(i.stage))}
      ${i.with ? field(word("with"), text(i.with)) : ""}
      ${i.stepAgeWeeks !== null ? field(word("stepAge"), `<bdi lang="${locale}" dir="${dir}">${weeks(i.stepAgeWeeks, locale)}</bdi>`) : ""}
    </div>
  </div>
  ${photo ? `<img class="photo" src="${html(photo)}" alt="">` : ""}
</section>`;
  };

  const footer = `${word("footer")} · ${word("page")} `;
  const footerContent = `${cssString(footer)} counter(page) ${cssString(` ${word("of")} `)} counter(pages)`;

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${html(word("title"))}</title>
<style>
${fonts.css}
@page {
  size: A4;
  margin: 16mm 13mm 20mm 13mm;
  @bottom-center { content: ${footerContent}; font-family: ${fonts.family}; font-size: 7.5pt; color: #444; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: ${fonts.family}; font-size: 9pt; line-height: 1.4; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.muted { color: #555; }
.top { border-bottom: 0.75pt solid #777; margin-bottom: 4mm; padding-bottom: 2mm; }
.top h1 { font-size: 15pt; margin: 0 0 1mm; }
.top .meta { color: #444; font-size: 8.5pt; }
.item { display: flex; gap: 4mm; border: 0.75pt solid #999; border-radius: 1.5mm; padding: 3mm 4mm; margin-bottom: 3mm; break-inside: avoid; }
.item .body { flex: 1 1 auto; min-width: 0; }
.item .head { font-weight: 700; font-size: 8.5pt; color: #333; }
.item h2 { font-size: 10.5pt; margin: 0.5mm 0 2mm; }
.fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1mm 4mm; }
.field { display: flex; flex-direction: column; }
.label { color: #555; font-size: 7.5pt; }
.value { font-weight: 700; }
.photo { flex: 0 0 38mm; width: 38mm; height: 28mm; object-fit: cover; border-radius: 1mm; }
.capped { margin-top: 3mm; padding: 2mm 3mm; border: 0.75pt solid #a15c00; color: #5d3600; border-radius: 1.5mm; }
</style>
</head>
<body>
<div class="top">
  <h1>${html(word("title"))}</h1>
  <div class="meta">${html(word("project"))}: ${text(content.projectName)} · ${html(word("items"))}: <bdi dir="ltr" class="ltr">${content.items.length}</bdi> · <bdi lang="${locale}" dir="${dir}">${html(formatDate(at, locale, { dateStyle: "medium" }))}</bdi></div>
</div>
${content.items.map(card).join("\n")}
${content.capped ? `<p class="capped">${html(word("capped"))}</p>` : ""}
</body>
</html>
`;
}
