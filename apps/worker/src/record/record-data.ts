import type { RecordFacts, TransitionFact } from "@rabaed/db";
import { outcomeLook, type OutcomeLook } from "@rabaed/domain";
import { formContent, isListedDocument, type RecordBlock, type RecordSection } from "./form-content.ts";
import { pick, type RecordLanguage, type RecordText } from "./record-text.ts";

// The Record Data (ADR 0023; workflow-engine.md §7; form-engine.md §6): one XML
// document holding exactly what the Documental Record prints, written once when
// the item closes and never changed. The PDF is made from it alone, and it
// travels inside the PDF, so it holds nothing the pages don't print: never a
// Return, an Internal Note, a Recommended Code, a Code the Owner sent back,
// Chat, an answer still in progress or when the Draft was started (V7). In a
// single-language record it holds only that language.
//
// Version 2 (RP-151) holds page 1 (the Companies, title block, Parties,
// Classification, Final decision, the reply's excerpt, the approval flow), the
// Form's sections and the shared Documents. RP-650 adds Signatures, Stamps,
// Review Comments and the endings; RP-147 the appendix.

/** The layout version the Record Data is printed with (layout.ts). */
export const LAYOUT_VERSION = "2";

/** Record Data's XML namespace, versioned with its shape. */
export const RECORD_DATA_NAMESPACE = "https://rabaed.com/ns/record-data/2";

export type { RecordFacts, TransitionFact };

/** Whether an outcome's code is printed as it is (A, B, C, D), rather than by its name. */
export const isShortCode = (code: string): boolean => code.length <= 2;

/** The mark beside an approval flow entry: done, returned for revision (Code C) or rejected (Code D). */
export type FlowMark = "done" | "revise" | "rejected";

export interface CompanyLine {
  readonly name: RecordText;
  readonly role: RecordText;
}

export interface PersonLine {
  readonly name: RecordText;
  readonly positions: readonly RecordText[];
  readonly company: RecordText;
  readonly role: RecordText;
}

export interface FlowEntry extends PersonLine {
  readonly label: RecordText;
  /** When it was taken (ISO 8601, UTC). */
  readonly at: string;
  readonly mark: FlowMark;
  readonly contentSha256: string | null;
}

export interface Chip {
  readonly code: string;
  readonly name: RecordText;
  /** The outcome the item closed with. */
  readonly issued: boolean;
}

export interface RecordData {
  readonly layoutVersion: string;
  readonly language: RecordLanguage;
  /** Whether Hijri dates print beside the Gregorian ones. */
  readonly hijri: boolean;
  readonly projectName: RecordText;
  readonly type: { readonly code: string; readonly name: RecordText };
  readonly documentNumber: string | null;
  readonly revisionNo: number;
  readonly revisionOf: { readonly documentNumber: string; readonly closedAt: string; readonly outcome: string } | null;
  readonly subject: string;
  readonly outcome: { readonly code: string; readonly name: RecordText; readonly look: OutcomeLook | null };
  readonly closedAt: string;
  readonly submittedAt: string | null;
  readonly chips: readonly Chip[];
  /** Who issued the outcome, and, in the Owner's review, who confirmed it. */
  readonly issuedBy: PersonLine | null;
  readonly confirmedBy: PersonLine | null;
  readonly reviewComments: number;
  /** The Owner and every Company whose Member acted, for the top of page 1. */
  readonly companies: readonly CompanyLine[];
  /** The Companies on the item by Project Role, for the Parties box. */
  readonly parties: readonly CompanyLine[];
  readonly trades: readonly { readonly name: RecordText; readonly selected: boolean }[];
  readonly location: readonly RecordText[];
  readonly scopes: readonly RecordText[];
  readonly classification: readonly RecordBlock[];
  /** The first lines of the issued Code's Remarks. */
  readonly reply: string | null;
  /** The Transitions on the path to the outcome (recordPath). */
  readonly transitions: readonly FlowEntry[];
  readonly sections: readonly RecordSection[];
  /** The shared Documents with their page counts (null where the file has no pages to count). */
  readonly documents: readonly { readonly fileName: string; readonly pages: number | null }[];
  /** The short code printed on every page, and the verification page's long link. */
  readonly verification: { readonly code: string; readonly link: string };
}

/** The Transitions that give an item back, never on the record (V7): a Return, and a Send Back (a Code the Owner sent back is one). */
const GIVES_BACK = new Set(["return", "send_back"]);

/**
 * The Transitions on the item's path to its outcome (V7). A Return or a Send
 * Back is never on it, whatever follows. It also makes a loop that comes back
 * to a Step the item left before; the work around it, up to the Step it left
 * again, is left out too, so each Step appears once, as the item last left it
 * (the first entry, "Prepared", is the last send out of the Draft).
 */
export function recordPath(transitions: readonly TransitionFact[]): TransitionFact[] {
  const path: TransitionFact[] = [];
  for (const t of transitions) {
    const back = path.findIndex((p) => p.fromStepId === t.fromStepId);
    if (back >= 0) path.length = back;
    path.push(t);
  }
  return path.filter((t) => !GIVES_BACK.has(t.kind));
}

const CANCELLED = { ar: "ملغى", en: "Cancelled" };
const PREPARED = { ar: "أُعدّ", en: "Prepared" };

/** The lines of a Reply's Remarks the first page shows: the first lines, up to a limit. */
export function replyExcerpt(remarks: string | null): string | null {
  const lines = (remarks ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 6).join("\n");
  const cut = shown.length > 700 ? `${shown.slice(0, 700).trimEnd()}…` : shown;
  return lines.length > 6 && cut === shown ? `${shown}…` : cut;
}

export function recordDataOf(
  facts: RecordFacts,
  verification: RecordData["verification"],
  /** The page counts of the Documents, by storage key. */
  pageCounts: ReadonlyMap<string, number | null> = new Map(),
): RecordData {
  const language = facts.recordLanguage;
  const path = recordPath(facts.transitions);
  const cancelled = facts.outcome === "cancelled";
  const set = facts.outcomes;
  const issuedOutcome = set.find((o) => o.code === facts.outcome);
  const look = issuedOutcome ? outcomeLook(issuedOutcome, set) : null;

  const person = (t: TransitionFact): PersonLine => ({
    name: pick(t.memberName, language),
    positions: t.positions.map((p) => pick(p, language)),
    company: pick(t.companyName, language),
    role: pick(t.roleName, language),
  });
  const closing = path.at(-1);
  const confirmation = path.findLast((t) => t.outcomeMode === "confirm_code");
  // Who issued it: the Step that gave the Code (or recommended it to the Owner, whose Confirm is `confirmedBy`).
  const issuer = cancelled ? closing : (path.findLast((t) => t.outcomeMode === "issue_code" || t.outcomeMode === "recommend_code") ?? closing);
  // The reply is the Remarks of the Code that is the outcome: never one the Owner sent back (it is off the path), none on a Cancel.
  const codeEntry = !cancelled && (closing?.outcomeMode === "issue_code" || closing?.outcomeMode === "confirm_code") ? closing : undefined;
  const markOf = (t: TransitionFact): FlowMark => (t === closing && look === "c" ? "revise" : t === closing && look === "d" ? "rejected" : "done");

  const { sections, classification, attachmentFieldKeys } = formContent(facts, language);
  const company = (c: RecordFacts["companies"][number]): CompanyLine => ({ name: pick(c.name, language), role: pick(c.roleName, language) });
  const acted = new Set(path.map((t) => t.participantId));

  return {
    layoutVersion: LAYOUT_VERSION,
    language,
    hijri: facts.hijriDates,
    projectName: pick(facts.projectName, language),
    type: { code: facts.type.code, name: pick(facts.type.name, language) },
    documentNumber: facts.documentNumber,
    revisionNo: facts.revisionNo,
    revisionOf: facts.revisionOf,
    subject: facts.subject,
    outcome: {
      code: facts.outcome,
      name: cancelled ? pick(CANCELLED, language) : pick(issuedOutcome?.name ?? { ar: facts.outcome, en: facts.outcome }, language),
      look,
    },
    closedAt: facts.closedAt,
    submittedAt: facts.submittedAt,
    chips: cancelled
      ? [{ code: "cancelled", name: pick(CANCELLED, language), issued: true }]
      : set.map((o) => ({ code: o.code, name: pick(o.name, language), issued: o.code === facts.outcome })),
    issuedBy: issuer ? person(issuer) : null,
    confirmedBy: confirmation && confirmation !== issuer ? person(confirmation) : null,
    reviewComments: facts.reviewComments,
    companies: facts.companies.filter((c) => c.baseRole === "owner" || acted.has(c.participantId)).map(company),
    parties: facts.companies.map(company),
    trades: facts.trades.map((t) => ({ name: pick(t.name, language), selected: t.selected })),
    location: (facts.location ?? []).map((l) => pick(l, language)),
    scopes: facts.scopes.map((s) => pick(s, language)),
    classification,
    reply: replyExcerpt(codeEntry?.remarks ?? null),
    transitions: path.map((t, i) => ({
      ...person(t),
      label: i === 0 ? pick(PREPARED, language) : pick(t.label, language),
      at: t.at,
      mark: markOf(t),
      contentSha256: t.contentSha256,
    })),
    sections,
    documents: facts.documents
      .filter((d) => isListedDocument(d, attachmentFieldKeys))
      .map((d) => ({ fileName: d.fileName, pages: pageCounts.get(d.storageKey) ?? null })),
    verification,
  };
}

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters XML 1.0 can't carry.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** `<tag lang="ar">…</tag>` for each language the text has. */
const lang = (tag: string, text: RecordText, indent: string, attributes = "") =>
  (["ar", "en"] as const)
    .filter((l) => text[l] !== undefined)
    .map((l) => `${indent}<${tag}${attributes} lang="${l}">${escape(text[l]!)}</${tag}>`);

const at = (iso: string) => ` at="${escape(iso)}"`;

function person(p: PersonLine, indent: string): string[] {
  return [
    `${indent}<member>`,
    ...lang("name", p.name, `${indent}  `),
    ...p.positions.flatMap((pos) => [`${indent}  <position>`, ...lang("name", pos, `${indent}    `), `${indent}  </position>`]),
    `${indent}</member>`,
    `${indent}<company>`,
    ...lang("name", p.company, `${indent}  `),
    `${indent}</company>`,
    ...lang("role", p.role, indent),
  ];
}

function blockXml(block: RecordBlock, indent: string): string[] {
  const i2 = `${indent}  `;
  switch (block.kind) {
    case "field":
      return [`${indent}<field>`, ...lang("label", block.label, i2), ...lang("value", block.value, i2), `${indent}</field>`];
    case "table":
      return [
        `${indent}<table>`,
        ...lang("label", block.label, i2),
        `${i2}<columns>`,
        ...block.columns.flatMap((c) => lang("column", c, `${i2}  `)),
        `${i2}</columns>`,
        ...block.rows.flatMap((row) => [`${i2}<row>`, ...row.flatMap((cell) => lang("cell", cell, `${i2}  `)), `${i2}</row>`]),
        ...(block.totals ? [`${i2}<totals>`, ...block.totals.flatMap((cell) => lang("cell", cell, `${i2}  `)), `${i2}</totals>`] : []),
        `${indent}</table>`,
      ];
    case "checklist":
      return [
        `${indent}<checklist>`,
        ...lang("label", block.label, i2),
        ...lang("summary", block.summary, i2),
        ...block.items.flatMap((item) => [
          `${i2}<item>`,
          ...lang("text", item.text, `${i2}  `),
          ...lang("answer", item.answer, `${i2}  `),
          ...(item.comment === null ? [] : [`${i2}  <comment>${escape(item.comment)}</comment>`]),
          ...item.photos.map((p) => `${i2}  <photo${p.takenAt ? at(p.takenAt) : ""}>${escape(p.fileName)}</photo>`),
          `${i2}</item>`,
        ]),
        `${indent}</checklist>`,
      ];
    case "photos":
      return [
        `${indent}<photos>`,
        ...lang("label", block.label, i2),
        ...block.photos.map((p) => `${i2}<photo${p.takenAt ? at(p.takenAt) : ""}>${escape(p.fileName)}</photo>`),
        `${indent}</photos>`,
      ];
  }
}

/** The Record Data as its XML document. */
export function recordDataXml(data: RecordData): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<recordData xmlns="${RECORD_DATA_NAMESPACE}" layoutVersion="${escape(data.layoutVersion)}" language="${data.language}" hijri="${data.hijri}">`,
    "  <project>",
    ...lang("name", data.projectName, "    "),
    "  </project>",
    "  <companies>",
    ...data.companies.flatMap((c) => ["    <company>", ...lang("name", c.name, "      "), ...lang("role", c.role, "      "), "    </company>"]),
    "  </companies>",
    "  <item>",
    `    <type code="${escape(data.type.code)}">`,
    ...lang("name", data.type.name, "      "),
    "    </type>",
    data.documentNumber === null ? "    <documentNumber/>" : `    <documentNumber>${escape(data.documentNumber)}</documentNumber>`,
    `    <revision>${data.revisionNo}</revision>`,
    ...(data.revisionOf
      ? [`    <revisionOf outcome="${escape(data.revisionOf.outcome)}"${at(data.revisionOf.closedAt)}>${escape(data.revisionOf.documentNumber)}</revisionOf>`]
      : []),
    `    <subject>${escape(data.subject)}</subject>`,
    // A short code (A, B, C, D) is printed in large type; any other outcome prints its name.
    `    <outcome${isShortCode(data.outcome.code) ? ` code="${escape(data.outcome.code)}"` : ""}${at(data.closedAt)}>`,
    ...lang("name", data.outcome.name, "      "),
    "    </outcome>",
    ...(data.submittedAt ? [`    <submitted${at(data.submittedAt)}/>`] : []),
    "  </item>",
    "  <parties>",
    ...data.parties.flatMap((c) => ["    <company>", ...lang("name", c.name, "      "), ...lang("role", c.role, "      "), "    </company>"]),
    "  </parties>",
    "  <classification>",
    "    <trades>",
    ...data.trades.flatMap((t) => lang("trade", t.name, "      ", t.selected ? ' selected="true"' : "")),
    "    </trades>",
    ...(data.location.length > 0 ? ["    <location>", ...data.location.flatMap((l) => lang("name", l, "      ")), "    </location>"] : []),
    ...(data.scopes.length > 0 ? ["    <scopes>", ...data.scopes.flatMap((s) => lang("name", s, "      ")), "    </scopes>"] : []),
    ...data.classification.flatMap((b) => blockXml(b, "    ")),
    "  </classification>",
    "  <decision>",
    // A chip is its code when short, else its name.
    ...data.chips.flatMap((c) =>
      isShortCode(c.code)
        ? [`    <chip code="${escape(c.code)}"${c.issued ? ' issued="true"' : ""}/>`]
        : lang("chip", c.name, "    ", c.issued ? ' issued="true"' : ""),
    ),
    ...(data.issuedBy ? ["    <issuedBy>", ...person(data.issuedBy, "      "), "    </issuedBy>"] : []),
    ...(data.confirmedBy ? ["    <confirmedBy>", ...person(data.confirmedBy, "      "), "    </confirmedBy>"] : []),
    `    <reviewComments>${data.reviewComments}</reviewComments>`,
    "  </decision>",
    ...(data.reply === null ? [] : [`  <reply>${escape(data.reply)}</reply>`]),
    "  <transitions>",
    ...data.transitions.flatMap((t, i) => [
      `    <transition n="${i + 1}"${at(t.at)} mark="${t.mark}"${t.contentSha256 ? ` contentSha256="${escape(t.contentSha256)}"` : ""}>`,
      ...lang("label", t.label, "      "),
      ...person(t, "      "),
      "    </transition>",
    ]),
    "  </transitions>",
    "  <form>",
    ...data.sections.flatMap((s) => ["    <section>", ...lang("title", s.title, "      "), ...s.blocks.flatMap((b) => blockXml(b, "      ")), "    </section>"]),
    "  </form>",
    "  <documents>",
    ...data.documents.map((d) => `    <document${d.pages === null ? "" : ` pages="${d.pages}"`}>${escape(d.fileName)}</document>`),
    "  </documents>",
    `  <verification code="${escape(data.verification.code)}" link="${escape(data.verification.link)}"/>`,
    "</recordData>",
    "",
  ];
  return lines.join("\n");
}
