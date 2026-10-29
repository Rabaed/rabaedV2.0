import { formatDate, formatHijriDate, type Locale } from "@rabaed/domain";
import type { RecordBlock, RecordPhoto } from "./form-content.ts";
import type { RecordFonts } from "./fonts.ts";
import { isShortCode, NO_IMAGES, REPLACED, type Chip, type CompanyLine, type FlowMark, type PersonLine, type RecordData, type RecordImages } from "./record-data.ts";
import { APPENDIX_CSS, appendixHtml } from "./appendix-layout.ts";
import { qrSvg } from "./qr.ts";
import { headingHtml, html, ltr, texts, WORDS, type RecordLanguage, type RecordText, type Word } from "./record-text.ts";
import type { WorkingCopyData } from "./working-copy.ts";

// The one Rabaed layout (form-engine.md §6; ADR 0023), printed from the Record
// Data only. Page 1 is the Companies, the title block, the Participants and
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
// person, no reply, no QR or Verification Code, none of what follows the Form on
// the record (Comments, Signature cards, Stamps, Disclaimer, appendix), its free
// Links after its Documents, and the Project's watermark across every page and in
// the footer.

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

/**
 * Where a probe render stops (pages.ts): after the start of the Review Comments (their heading, first
 * author and first Comment, which print together), or at the start of the answers of the last card
 * (the issuing one, which holds the reply's full text). Nothing after it is drawn, so its last page
 * is the page that part starts on. `appendixList` (RP-147, appendix.ts) draws the whole record and
 * the appendix's list, but not the appendix's pages: where they start.
 */
export type RecordCut = { readonly commentsStart: true } | { readonly replyCard: true } | { readonly appendixList: true };

/**
 * The record's HTML. `images` are the data URLs of the images it prints by storage key, and
 * `marks` says which of them each logo, Signature and Stamp is (RecordImages: never in the Record Data). The appendix's
 * images are not among them: they are drawn into their frames afterwards (appendix.ts).
 * A Working Copy (WorkingCopyData) prints the same page without the sealed record's own parts.
 */
export function recordHtml(
  data: RecordData | WorkingCopyData,
  fonts: RecordFonts,
  images: ReadonlyMap<string, string> = new Map(),
  marks: RecordImages = NO_IMAGES,
  cut?: RecordCut,
): string {
  const language: RecordLanguage = data.language;
  /** The sealed record's own parts; null on a Working Copy. */
  const record = "verification" in data ? data : null;
  const copy = "verification" in data ? null : data;
  const locales: Locale[] = language === "bilingual" ? ["ar", "en"] : [language];

  /** An Arabic heading with its English label beside it (bilingual), or one language. */
  const heading = (word: Word) => headingHtml(word, language);

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

  // A Revision's stored number already ends in " Rev n" (workflow-engine.md, Revisions), so it prints as it is (RP-1059).
  const number = data.documentNumber ?? "—";
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
  const companyBox = (c: CompanyLine, i: number) => {
    const key = c.logo ? marks.logos[i] : null;
    const logo = key ? images.get(key) : undefined;
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

  const photo = (p: RecordPhoto) => {
    const image = images.get(p.storageKey);
    // A photo past the inline limits (assets.ts) prints its fingerprint instead of its picture (RP-982).
    return `<figure class="photo">${image ? `<img src="${image}" alt="">` : '<div class="noimage"></div>'}<figcaption><bdi dir="ltr">${html(p.fileName)}</bdi>${
      p.takenAt ? `<div class="muted">${heading("takenAt")}: ${when(p.takenAt)}</div>` : ""
    }${!image && p.sha256 ? `<div class="muted fp">${heading("fingerprint")}: ${ltr(p.sha256)}</div>` : ""}</figcaption></figure>`;
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
                item.snag ? `<div class="muted">${txt(item.snag)}</div>` : ""
              }${
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

  // Paired as txt() pairs every bilingual value: the Arabic sentence, then the English on its own line in
  // the same column, so a wrapped line never mixes the two. The date is the record's one format, as
  // every date beside a label (RP-1059).
  const paired = (fn: (l: Locale) => string) =>
    language === "bilingual"
      ? `<span lang="ar" class="line">${fn("ar")}</span><span class="line en"><bdi lang="en" dir="ltr">${fn("en")}</bdi></span>`
      : `<span lang="${language}" dir="${dirOf(language)}" class="line">${fn(language)}</span>`;
  const revisionOf = data.revisionOf;
  const revisionLine = revisionOf
    ? `<div class="revision">${paired(
        (l) =>
          `${WORDS.revisionOf[l]} ${ltr(revisionOf.documentNumber)}, ${WORDS.closedAtCode[l]} ${html(revisionOf.outcome)} ${WORDS.closedOn[l]} ${day(revisionOf.closedAt)}`,
      )}</div>`
    : "";

  // The running header on every page after the first: the Type badge, the Subject, the Document
  // Number and Revision, the outcome badge. Each part bidi-isolated, as in the footer.
  const FSI = "\u2068";
  const outcomeBadge = record
    ? isShortCode(record.outcome.code)
      ? `${LRI}${record.outcome.code}${PDI}`
      : texts(record.outcome.name).map((n) => `${FSI}${n}${PDI}`).join(" / ")
    : copy?.stage
      ? texts(copy.stage).map((n) => `${FSI}${n}${PDI}`).join(" / ")
      : "";
  const headerContent = cssString(`${LRI}${data.type.code}${PDI}  ·  ${FSI}${data.subject}${PDI}  ·  ${LRI}${number}${PDI}  ·  ${outcomeBadge}`);

  const image = (key: string | null | undefined, cls: string) => {
    const src = key ? images.get(key) : undefined;
    return src ? `<img class="${cls}" src="${src}" alt="">` : "";
  };
  /** A sentence in each of the record's languages, each on its own line. */
  const sentence = (fn: (l: Locale) => string) => locales.map((l) => `<div class="line" lang="${l}" dir="${dirOf(l)}">${fn(l)}</div>`).join("");

  /** The sealed record's own parts after the Form: Review Comments, Signature cards, Next step, Stamps, Disclaimer, appendix. */
  function recordParts(data: RecordData) {
  const cancellation = data.cancellation
    ? data.cancellation.companyLeft
      ? `<dt></dt><dd>${sentence((l) => `${WORDS.byRabaed[l]} ${html(data.cancellation!.companyLeft![l] ?? "")} ${WORDS.leftProject[l]}`)}</dd>`
      : `${data.cancellation.by ? `<dt>${heading("cancelledBy")}</dt><dd>${person(data.cancellation.by)}</dd>` : ""}${
          data.cancellation.reason ? `<dt>${heading("reason")}</dt><dd class="pre"><bdi>${html(data.cancellation.reason)}</bdi></dd>` : ""
        }`
    : "";

  // The parts after the Form run on where there is room, never from a forced new page (RP-1059).
  // A probe to the Comments' start draws their heading, first author and first Comment only.
  const commentsStart = cut !== undefined && "commentsStart" in cut;
  const groups = commentsStart ? data.comments.slice(0, 1).map((g) => ({ ...g, items: g.items.slice(0, 1) })) : data.comments;
  const commentsPart =
    data.comments.length === 0
      ? ""
      : `<section class="comments"><h2 class="part">${heading("reviewComments")}</h2>${groups
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

  // The issuing card, when page 1 points to the reply's full text in it, may run across pages, so its
  // answers start right after its head, where a probe that stops there finds them (pages.ts).
  const replyCard = data.reply?.cut ? data.cards.length - 1 : -1;
  const cardHtml = (c: RecordData["cards"][number], i: number, withLines = true) => `<article class="card${i === replyCard ? " flows" : ""}">
  <div class="card-head"><span class="num">${i + 1}</span> <span class="strong">${inline(c.verb)}</span>${i === 0 ? "" : ` <span class="muted">· ${inline(c.label)}</span>`}</div>
  <div class="card-body">
    <div>${person(c)}<div class="muted">${when(c.at)}</div></div>
    <div class="sigbox">${image(c.signature ? marks.signatures[i] : null, "sig")}<div class="muted">${heading("signature")}</div></div>
  </div>
  ${(withLines ? c.lines : [])
    .map((line) =>
      line.kind === "text"
        ? `<div class="answer"><div class="alabel">${txt(line.label)}</div><div class="pre">${txt(line.value)}</div></div>`
        : `<div class="answer"><div class="alabel">${txt(line.label)}</div><ol class="numbered">${line.items.map((item, n) => `<li><span class="n">${n + 1}.</span><div>${txt(item)}</div></li>`).join("")}</ol></div>`,
    )
    .join("")}
</article>`;
  // A probe to the reply's card draws every card, the last without its answers.
  const cardsHtml = data.cards.map((c, i) => cardHtml(c, i, !(cut && "replyCard" in cut && i === data.cards.length - 1))).join("");
  const signaturesPart = commentsStart ? "" : `<section class="signatures"><h2 class="part">${heading("signatures")}</h2>${cardsHtml}</section>`;
  const appendixList = cut !== undefined && "appendixList" in cut;
  const ended = cut === undefined || appendixList;
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
          .map((s, i) => `<figure class="stamp">${image(s.image ? marks.stamps[i]! : null, "stampimg") || '<div class="nostamp"></div>'}<figcaption><div class="strong">${txt(s.role)}</div><div class="muted">${txt(s.company)}</div></figcaption></figure>`)
          .join("")}</div></section>`
      : "";
  const disclaimerPart = ended && data.disclaimer ? `<section class="box disclaimer"><h2>${heading("disclaimer")}</h2><div class="pre">${txt(data.disclaimer)}</div></section>` : "";
  // The appendix (element 15, RP-147) comes after the Disclaimer.
  const appendixPart = ended ? appendixHtml(data, !appendixList) : "";
  return { cancellation, after: `${commentsPart}${signaturesPart}${nextStepPart}${stampsPart}${disclaimerPart}${appendixPart}` };
  }
  const parts = record ? recordParts(record) : null;
  // A Working Copy's free Links follow its Documents.
  const after = parts
    ? parts.after
    : copy && copy.links.length > 0
      ? `<section class="form"><h2>${heading("links")}</h2><table><tbody>${copy.links
          .map((l) => `<tr><td class="linkno">${ltr(l.documentNumber)}</td><td><bdi>${html(l.subject)}</bdi></td></tr>`)
          .join("")}</tbody></table></section>`
      : "";

  /** The sealed record's Final decision box: the outcome, who issued it, the dates, Review Comments, and the QR with the Verification Code. */
  const decisionBox = (r: RecordData) => `<section class="box">
  <h2>${heading("decision")}</h2>
  <div class="decision">
    <div>
      <div class="outcome">${isShortCode(r.outcome.code) ? ltr(r.outcome.code) : txt(r.outcome.name)}</div>
      ${isShortCode(r.outcome.code) ? `<div>${txt(r.outcome.name)}</div>` : ""}
      <div class="chips">${r.chips.map((c) => `<span class="chip${c.issued ? " issued" : ""}">${chipText(c)}</span>`).join("")}</div>
      <dl>
        ${r.issuedBy ? `<dt>${heading("issuedBy")}</dt><dd>${person(r.issuedBy)}</dd>` : ""}
        ${r.confirmedBy ? `<dt>${heading("confirmedBy")}</dt><dd>${person(r.confirmedBy)}</dd>` : ""}
        ${r.submittedAt ? `<dt>${heading("submitted")}</dt><dd>${day(r.submittedAt)}</dd>` : ""}
        <dt>${heading("replied")}</dt><dd>${day(r.closedAt)}</dd>
        ${r.reviewDays !== null ? `<dt>${heading("reviewDuration")}</dt><dd>${ltr(String(r.reviewDays))}</dd>` : ""}
        <dt>${heading("comments")}</dt><dd>${ltr(String(r.reviewComments))}${
          r.pages.comments !== null && r.comments.length > 0 ? ` <span class="muted">· ${heading("page")} ${ltr(String(r.pages.comments))}</span>` : ""
        }</dd>
        ${parts!.cancellation}
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
  <div class="chips">${c.chips.map((chip) => `<span class="chip">${chipText(chip)}</span>`).join("")}</div>
  ${c.submittedAt ? `<dl><dt>${heading("submitted")}</dt><dd>${day(c.submittedAt)}</dd></dl>` : ""}
</section>`;

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
.box > h2 { font-size: 9.5pt; margin: -3mm -4mm 3mm; padding: 1.6mm 4mm; background: #eee; border-bottom: 0.75pt solid #777; border-radius: 1.5mm 1.5mm 0 0; break-after: avoid; }
/* The approval flow starts on page 1 right after the box before it and runs on by whole rows, its head repeated (RP-1059). */
.box.flow { break-inside: auto; }
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
section.form > h2 { font-size: 11pt; margin: 5mm 0 2mm; border-bottom: 1pt solid #111; padding-bottom: 1mm; break-after: avoid; }
.tablewrap { grid-column: 1 / -1; margin: 2mm 0; }
.tlabel { font-weight: 700; margin-bottom: 1mm; }
.photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 1.5mm; }
.photo { margin: 0; break-inside: avoid; font-size: 7.5pt; }
.photo img { width: 100%; max-height: 45mm; object-fit: cover; border: 0.5pt solid #999; display: block; }
.photo .noimage { height: 20mm; border: 0.5pt dashed #999; }
.photo .fp { font-size: 6pt; word-break: break-all; }
.mark { vertical-align: middle; }
.pre { white-space: pre-line; }
.logo { display: block; max-height: 12mm; max-width: 40mm; margin-bottom: 1.5mm; }
.pointer { margin-top: 1.5mm; }
h2.part { font-size: 12pt; margin: 5mm 0 3mm; border-bottom: 1.5pt solid #111; padding-bottom: 1mm; break-after: avoid; }
.signatures, .comments { margin-bottom: 4mm; }
.author { display: flex; gap: 3mm; align-items: center; margin: 3mm 0 2mm; break-after: avoid; }
.avatar { width: 10mm; height: 10mm; border-radius: 50%; background: #111; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 9pt; flex: none; }
ol.review-items, ol.numbered { list-style: none; margin: 0 0 3mm; padding: 0; }
ol.review-items > li, ol.numbered > li { display: flex; gap: 2mm; padding: 1.2mm 0; border-bottom: 0.5pt solid #ddd; break-inside: avoid; }
ol.numbered > li { border-bottom: none; padding: 0.4mm 0; }
li > .n { font-weight: 700; min-width: 6mm; }
.card { border: 0.75pt solid #777; border-radius: 1.5mm; padding: 2.5mm 4mm; margin-bottom: 3mm; break-inside: avoid; }
.card.flows { break-inside: auto; }
/* A card's head keeps with its body, and its body with its first answer. A body with no answer after it
   is the card's last child: its break-after would pass to the card and chain it to the next (RP-1076). */
.card-head, .card-body, .alabel { break-inside: avoid; }
.card-head, .card-body:not(:last-child), .alabel { break-after: avoid; }
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
.stage { font-size: 16pt; font-weight: 700; line-height: 1.2; margin-bottom: 1mm; }
td.linkno { width: 45mm; }
/* A Working Copy's watermark: fixed, so Chromium prints it on every page, over the content. */
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); z-index: 10; text-align: center; white-space: nowrap; font-size: 54pt; font-weight: 700; line-height: 1.15; color: rgba(160, 30, 30, 0.16); }
.watermark .en { color: inherit; }
${APPENDIX_CSS}
</style>
</head>
<body>
${copy ? `<div class="watermark">${txt(copy.watermark)}</div>` : ""}
<div class="companies">${data.companies.map(companyBox).join("")}</div>
<section class="title-block">
  <h1>${txt(data.type.name)} <span class="badge">${ltr(data.type.code)}</span></h1>
  <dl>
    <dt>${heading("subject")}</dt><dd><bdi>${html(data.subject)}</bdi></dd>
    <dt>${heading("number")}</dt><dd>${ltr(number)}</dd>
  </dl>
  ${revisionLine}
</section>
<div class="two">
  <section class="box">
    <h2>${heading("participants")}</h2>
    <dl>
      <dt>${heading("project")}</dt><dd>${txt(data.projectName)}</dd>
      ${data.participants.map((c) => `<dt>${txt(c.role)}</dt><dd>${txt(c.name)}</dd>`).join("")}
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
    ? `<section class="box"><h2>${heading("reply")}</h2><div class="reply"><bdi>${html(record.reply.text)}</bdi></div>${
        record.pages.reply !== null ? `<div class="pointer muted">${heading("fullText")} ${ltr(String(record.pages.reply))}</div>` : ""
      }</section>`
    : ""
}
<section class="box flow">
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
