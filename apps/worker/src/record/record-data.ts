import type { CommentFact, RecordFacts, TransitionFact } from "@rabaed/db";
import { offersReplacement, offersRevision, outcomeLook, riyadhDay, type BilingualText, type OutcomeLook } from "@rabaed/domain";
import { actionAnswerLines, type CardLine } from "./action-answers.ts";
import { formContent, isListedDocument, type RecordBlock, type RecordPhoto, type RecordSection } from "./form-content.ts";
import { sectionsWithFingerprints, withFingerprints } from "./photo-fingerprints.ts";
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
// Form's sections and the shared Documents. Version 3 (RP-650) adds the pages
// after: the Review Comments, a Signature card per Transition on the path (with
// what its shared Action Form holds), the Next step, the Stamps, the Disclaimer;
// and on page 1 the logos, the review duration, a Cancel's who and why, and the
// pages the Comments and the reply's full text are on. An image (logo, Signature,
// Stamp) is only flagged: its bytes are printed, its storage key never held.
// Version 4 (RP-147) adds the appendix: each shared Document of it by name and
// fingerprint, and whether the record gives its pages (which), carries it inside
// the PDF, or only lists it, held in Rabaed. Never its storage key or its size.
//
// Each Form photo, logo, Signature and Stamp whose image the page prints also carries
// that image's fingerprint (a `sha256` attribute, RP-155), so a Re-produce finds the
// same file again. It is not text on the page: it fingerprints the picture the page
// prints.

/** The layout version the Record Data is printed with (layout.ts). */
export const LAYOUT_VERSION = "4";

/** Record Data's XML namespace, versioned with its shape. */
export const RECORD_DATA_NAMESPACE = "https://rabaed.com/ns/record-data/4";

export type { RecordFacts, TransitionFact };

/** Whether an outcome's code is printed as it is (A, B, C, D), rather than by its name. */
export const isShortCode = (code: string): boolean => code.length <= 2;

/** The mark beside an approval flow entry: done, returned for revision (Code C) or rejected (Code D). */
export type FlowMark = "done" | "revise" | "rejected";

export interface CompanyLine {
  readonly name: RecordText;
  readonly role: RecordText;
  /** Whether it prints its logo in force at the close (the companies strip only); its name always. */
  readonly logo?: boolean;
  /** The fingerprint (hex SHA-256) of the logo it prints (RP-155: how a Re-produce finds it again). */
  readonly logoSha256?: string | null;
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
  /** The first lines of the issued Code's Remarks, and whether page 1 cut them short. */
  readonly reply: ReplyExcerpt | null;
  /** The Transitions on the path to the outcome (recordPath). */
  readonly transitions: readonly FlowEntry[];
  readonly sections: readonly RecordSection[];
  /** The shared Documents with their page counts (null where the file has no pages to count). */
  readonly documents: readonly { readonly fileName: string; readonly pages: number | null }[];
  /** The short code printed on every page, and the verification page's long link. */
  readonly verification: { readonly code: string; readonly link: string };
  /** The calendar days from the Submission Date to the reply, when the Form shows them (information, never a deadline). */
  readonly reviewDays: number | null;
  /** Who cancelled it and why; Rabaed's own cancel when a Company left the Project. Null unless Cancelled. */
  readonly cancellation: Cancellation | null;
  /** The Comments the issued Code raised, by author (form-engine.md §6, element 11). */
  readonly comments: readonly CommentGroup[];
  /** One card per Transition on the path (element 12). */
  readonly cards: readonly SignatureCard[];
  /** What comes next: a Revision by the raiser (Code C), or a replacement (Code D). */
  readonly nextStep: NextStep | null;
  /** The Stamp of every Company whose Member acted on the path (element 13). */
  readonly stamps: readonly StampLine[];
  /** The Form Version's Disclaimer (element 14). */
  readonly disclaimer: RecordText | null;
  /** The pages the pointers on page 1 name, found by rendering (pages.ts): null until then. */
  readonly pages: { readonly comments: number | null; readonly reply: number | null };
  /** The appendix (element 15, RP-147): set by the job (appendix.ts), empty until then. */
  readonly appendix: readonly AppendixEntry[];
}

/**
 * A shared Document of the appendix, by how the record holds it: its pages follow in the record,
 * it travels inside the PDF (opened from the paperclip), or, past the size limit, it is only listed
 * and held in Rabaed.
 */
export type AppendixEntry = AppendixPages | AppendixAttached | AppendixHeld;

interface AppendixFile {
  readonly fileName: string;
  /** Its bytes' SHA-256 (hex, RP-618; worked out from the stored bytes for a Document from before it). */
  readonly sha256: string;
}

/** A PDF or image whose pages follow in the record. */
export interface AppendixPages extends AppendixFile {
  readonly way: "pages";
  /** How many pages it takes (one for an image); the Record Data holds its first and last page instead. */
  readonly pageCount: number;
  /** The record's pages that give it, once rendering has counted them (appendix.ts); null only until then. */
  readonly pages: { readonly first: number; readonly last: number } | null;
}

/** A file carried inside the PDF: any other file, or a PDF the record can't give as pages. */
export interface AppendixAttached extends AppendixFile {
  readonly way: "attached";
  /** A PDF with more pages than the record gives (MAX_APPENDIX_PDF_PAGES): the list says so. */
  readonly tooManyPages: boolean;
}

/** A file past the size limit: only listed, held in Rabaed. */
export interface AppendixHeld extends AppendixFile {
  readonly way: "held";
}

export interface ReplyExcerpt {
  readonly text: string;
  /** Whether lines or characters were left out: page 1 then points to the full text. */
  readonly cut: boolean;
}

/**
 * Where the images the record prints are stored, for the renderer only: never part of the
 * Record Data, which only flags them (visibility.md, Documental Record row). Each list is in the
 * order of the Record Data's `companies` (logos), `cards` (Signatures) and `stamps`; null where
 * there is none, or the job could not read it.
 */
export interface RecordImages {
  readonly logos: readonly (string | null)[];
  readonly signatures: readonly (string | null)[];
  readonly stamps: readonly (string | null)[];
}

export const NO_IMAGES: RecordImages = { logos: [], signatures: [], stamps: [] };

export interface Cancellation {
  /** The Member who took the Cancel; null when Rabaed cancelled it. */
  readonly by: PersonLine | null;
  readonly reason: string | null;
  /** The Company whose leaving the Project made Rabaed cancel it. */
  readonly companyLeft: RecordText | null;
}

export interface CommentGroup {
  readonly author: PersonLine;
  readonly initials: RecordText;
  readonly at: string;
  readonly items: readonly { readonly n: number; readonly documentNumber: string | null; readonly comment: string; readonly reference: string | null }[];
}

export interface SignatureCard extends PersonLine {
  readonly verb: RecordText;
  readonly label: RecordText;
  readonly at: string;
  /** Whether it prints the Signature the Transition's event recorded. */
  readonly signature: boolean;
  /** The fingerprint (hex SHA-256) of the Signature it prints. */
  readonly signatureSha256?: string | null;
  readonly lines: readonly CardLine[];
}

export type NextStep = { readonly kind: "revision"; readonly revisionNo: number; readonly company: RecordText } | { readonly kind: "replacement" };

export interface StampLine {
  readonly company: RecordText;
  readonly role: RecordText;
  /** Whether it prints the Stamp in force at the close. */
  readonly image: boolean;
  /** The fingerprint (hex SHA-256) of the Stamp it prints. */
  readonly imageSha256?: string | null;
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
/** Code D's Next step (form-engine.md §6, element 12). */
export const REPLACED = { ar: "يحل محله تقديم جديد", en: "A new submittal replaces this one" };
const PREPARED = { ar: "أُعدّ", en: "Prepared" };

/** A card's verb (form-engine.md §6, element 12). An internal reviewer's is "Reviewed", with no Code of his own (V7, RP-615). */
const VERBS = {
  prepared: { ar: "أعده", en: "Prepared" },
  submitted: { ar: "قدمه", en: "Submitted" },
  reviewed: { ar: "راجعه", en: "Reviewed" },
  approved: { ar: "اعتمده", en: "Approved" },
  confirmed: { ar: "أكده", en: "Confirmed" },
  cancelled: { ar: "ألغاه", en: "Cancelled" },
} satisfies Record<string, { ar: string; en: string }>;

/** The days between two instants' calendar dates in Riyadh. */
export function calendarDays(fromIso: string, toIso: string): number {
  const day = (iso: string) => Date.parse(`${riyadhDay(new Date(iso))}T00:00:00Z`) / 86_400_000;
  return day(toIso) - day(fromIso);
}

/** "Code D" (or the outcome's name when it has no short code): what the Owner's review's Recommendation prints as (ADR 0022). */
const codeLabel = (code: string, name: BilingualText): BilingualText =>
  isShortCode(code) ? { ar: `الرمز ${code}`, en: `Code ${code}` } : name;

/** A name's initials: the first letter of its first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  const first = (w: string | undefined) => (w ? [...w][0]! : "");
  return words.length > 1 ? `${first(words[0])}${first(words.at(-1))}` : first(words[0]);
}

const mapText = (t: RecordText, fn: (s: string) => string): RecordText => ({
  ...(t.ar !== undefined ? { ar: fn(t.ar) } : {}),
  ...(t.en !== undefined ? { en: fn(t.en) } : {}),
});

/** The lines of a Reply's Remarks the first page shows: the first lines, up to a limit, with "…" where it cut them. */
export function replyExcerpt(remarks: string | null): ReplyExcerpt | null {
  const lines = (remarks ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 6).join("\n");
  if (shown.length > 700) return { text: `${shown.slice(0, 700).trimEnd()}…`, cut: true };
  return lines.length > 6 ? { text: `${shown}…`, cut: true } : { text: shown, cut: false };
}

export function recordDataOf(
  facts: RecordFacts,
  verification: RecordData["verification"],
  pageCounts: ReadonlyMap<string, number | null> = new Map(),
  hasImage: (key: string) => boolean = () => true,
  fingerprints: ReadonlyMap<string, string> = new Map(),
): RecordData {
  return recordOf(facts, verification, pageCounts, hasImage, fingerprints).data;
}

/** The Record Data of a closed item, and where the images it flags are stored (for the renderer only). */
export function recordOf(
  facts: RecordFacts,
  verification: RecordData["verification"],
  /** The page counts of the Documents, by storage key. */
  pageCounts: ReadonlyMap<string, number | null> = new Map(),
  /** Whether the image stored under a key could be read: one that can't is printed as missing, and the Record Data says so. */
  hasImage: (key: string) => boolean = () => true,
  /** The SHA-256 (hex) of each image the page prints (Form photos, logos, Signatures, Stamps), by storage key. */
  fingerprints: ReadonlyMap<string, string> = new Map(),
): { data: RecordData; images: RecordImages } {
  const language = facts.recordLanguage;
  const imageKey = (image: { readonly storageKey: string } | null): string | null => (image && hasImage(image.storageKey) ? image.storageKey : null);
  const fingerprintOf = (key: string | null): string | null => (key === null ? null : (fingerprints.get(key) ?? null));
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
  const byRabaed = cancelled && facts.cancelledByRabaed !== null;
  // Who issued it: the Step that gave the Code (or recommended it to the Owner, whose Confirm is `confirmedBy`).
  // A Cancel issues nothing: who cancelled it is the cancellation's.
  const issuer = cancelled ? undefined : (path.findLast((t) => t.outcomeMode === "issue_code" || t.outcomeMode === "recommend_code") ?? closing);
  // The reply is the Remarks of the Code that is the outcome: never one the Owner sent back (it is off the path), none on a Cancel.
  const codeEntry = !cancelled && (closing?.outcomeMode === "issue_code" || closing?.outcomeMode === "confirm_code") ? closing : undefined;
  const markOf = (t: TransitionFact): FlowMark => (t === closing && look === "c" ? "revise" : t === closing && look === "d" ? "rejected" : "done");

  const { sections, classification, attachmentFieldKeys } = formContent(facts, language);
  const company = (c: RecordFacts["companies"][number]): CompanyLine => ({ name: pick(c.name, language), role: pick(c.roleName, language) });
  const acted = new Set(path.map((t) => t.participantId));
  const companyOf = (participantId: string) => facts.companies.find((c) => c.participantId === participantId);

  // The Owner's review (ADR 0022): the Consultant PM's Recommendation prints as the Code it issued, never
  // as a Recommendation, a step the Contractor never sees; its Remarks stay with the two Companies.
  const recommendStep = confirmation && issuer?.outcomeMode === "recommend_code" ? issuer : undefined;
  const labelOf = (t: TransitionFact, i: number): BilingualText =>
    t === recommendStep
      ? codeLabel(facts.outcome, issuedOutcome?.name ?? { ar: facts.outcome, en: facts.outcome })
      : i === 0 && t.kind !== "cancel"
        ? PREPARED
        : t.label;
  const verbOf = (t: TransitionFact, i: number): BilingualText => {
    if (t.kind === "cancel") return VERBS.cancelled;
    if (i === 0) return VERBS.prepared;
    if (t.outcomeMode === "confirm_code") return VERBS.confirmed;
    if (t === issuer) return issuedOutcome?.polarity === "positive" ? VERBS.approved : VERBS.reviewed;
    return t.kind === "submit" ? VERBS.submitted : VERBS.reviewed;
  };
  const signatures = path.map((t) => imageKey(t.signature));
  const cards: SignatureCard[] = path.map((t, i) => ({
    ...person(t),
    verb: pick(verbOf(t, i), language),
    label: pick(labelOf(t, i), language),
    at: t.at,
    signature: signatures[i] !== null,
    signatureSha256: fingerprintOf(signatures[i] ?? null),
    lines: t === recommendStep ? [] : actionAnswerLines(t.actionForm, t.answers, language),
  }));

  // The Comments by author, in the reply's order, numbered through: a new author card whenever who raised them changes.
  const comments: CommentGroup[] = [];
  const sameAuthor = (a: CommentFact, b: CommentFact) =>
    a.participantId === b.participantId && a.at === b.at && a.memberName.en === b.memberName.en && a.memberName.ar === b.memberName.ar;
  let group: { first: CommentFact; items: CommentGroup["items"][number][] } | undefined;
  const groups: { first: CommentFact; items: CommentGroup["items"][number][] }[] = [];
  facts.comments.forEach((c, i) => {
    if (!group || !sameAuthor(group.first, c)) {
      group = { first: c, items: [] };
      groups.push(group);
    }
    group.items.push({ n: i + 1, documentNumber: c.documentNumber, comment: c.comment, reference: c.reference });
  });
  for (const { first: c, items } of groups) {
    const name = pick(c.memberName, language);
    comments.push({
      author: { name, positions: c.positions.map((p) => pick(p, language)), company: pick(c.companyName, language), role: pick(c.roleName, language) },
      initials: mapText(name, initialsOf),
      at: c.at,
      items,
    });
  }

  const stampCompanies = [...new Set(path.map((t) => t.participantId))].flatMap((id) => companyOf(id) ?? []);
  const stampKeys = stampCompanies.map((c) => imageKey(c.stamp));
  const stamps: StampLine[] = stampCompanies.map((c, i) => ({ company: pick(c.name, language), role: pick(c.roleName, language), image: stampKeys[i] !== null, imageSha256: fingerprintOf(stampKeys[i] ?? null) }));
  const stripCompanies = facts.companies.filter((c) => c.baseRole === "owner" || acted.has(c.participantId));
  const logoKeys = stripCompanies.map((c) => imageKey(c.logo));

  const raiser = companyOf(facts.raiserParticipantId);
  const nextStep: NextStep | null =
    cancelled || !issuedOutcome
      ? null
      : offersRevision(issuedOutcome) && raiser
        ? { kind: "revision", revisionNo: facts.revisionNo + 1, company: pick(raiser.name, language) }
        : offersReplacement(issuedOutcome)
          ? { kind: "replacement" }
          : null;

  const reason = closing?.kind === "cancel" && typeof closing.answers?.reason === "string" ? closing.answers.reason.trim() || null : null;
  const cancellation: Cancellation | null = !cancelled
    ? null
    : byRabaed
      ? { by: null, reason: null, companyLeft: pick(facts.cancelledByRabaed!.companyName, language) }
      : { by: closing?.kind === "cancel" ? person(closing) : null, reason, companyLeft: null };

  const data: RecordData = {
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
    companies: stripCompanies.map((c, i) => ({ ...company(c), logo: logoKeys[i] !== null, logoSha256: fingerprintOf(logoKeys[i] ?? null) })),
    parties: facts.companies.map(company),
    trades: facts.trades.map((t) => ({ name: pick(t.name, language), selected: t.selected })),
    location: (facts.location ?? []).map((l) => pick(l, language)),
    scopes: facts.scopes.map((s) => pick(s, language)),
    classification: withFingerprints(classification, fingerprints),
    reply: replyExcerpt(codeEntry?.remarks ?? null),
    transitions: path.map((t, i) => ({
      ...person(t),
      label: pick(labelOf(t, i), language),
      at: t.at,
      mark: markOf(t),
      contentSha256: t.contentSha256,
    })),
    sections: sectionsWithFingerprints(sections, fingerprints),
    documents: facts.documents
      .filter((d) => isListedDocument(d, attachmentFieldKeys))
      .map((d) => ({ fileName: d.fileName, pages: pageCounts.get(d.storageKey) ?? null })),
    verification,
    reviewDays: !cancelled && facts.pdf?.show_review_duration && facts.submittedAt ? calendarDays(facts.submittedAt, facts.closedAt) : null,
    cancellation,
    comments,
    cards,
    nextStep,
    stamps,
    disclaimer: facts.pdf?.disclaimer ? pick(facts.pdf.disclaimer, language) : null,
    pages: { comments: null, reply: null },
    appendix: [],
  };
  return { data, images: { logos: logoKeys, signatures, stamps: stampKeys } };
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

function cancellationXml(c: Cancellation, indent: string): string[] {
  if (c.companyLeft) return [`${indent}<cancelledByRabaed>`, `${indent}  <company>`, ...lang("name", c.companyLeft, `${indent}    `), `${indent}  </company>`, `${indent}</cancelledByRabaed>`];
  return [
    `${indent}<cancelled>`,
    ...(c.by ? [`${indent}  <by>`, ...person(c.by, `${indent}    `), `${indent}  </by>`] : []),
    ...(c.reason ? [`${indent}  <reason>${escape(c.reason)}</reason>`] : []),
    `${indent}</cancelled>`,
  ];
}
/** An image's fingerprint attribute, when the job read the image. */
const sha = (sha256: string | null | undefined) => (sha256 ? ` sha256="${escape(sha256)}"` : "");

const photoXml = (p: RecordPhoto) => `<photo${p.takenAt ? at(p.takenAt) : ""}${sha(p.sha256)}>${escape(p.fileName)}</photo>`;

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
          ...item.photos.map((p) => `${i2}  ${photoXml(p)}`),
          `${i2}</item>`,
        ]),
        `${indent}</checklist>`,
      ];
    case "photos":
      return [
        `${indent}<photos>`,
        ...lang("label", block.label, i2),
        ...block.photos.map((p) => `${i2}${photoXml(p)}`),
        `${indent}</photos>`,
      ];
  }
}

/** The appendix's list (element 15): each file by name and fingerprint, its pages, or a flag for how it is held. */
function appendixXml(appendix: readonly AppendixEntry[]): string[] {
  if (appendix.length === 0) return [];
  return [
    "  <appendix>",
    ...appendix.flatMap((f, i) => [
      `    <file n="${i + 1}" sha256="${escape(f.sha256)}">`,
      `      <name>${escape(f.fileName)}</name>`,
      ...(f.way === "pages"
        ? [f.pages ? `      <pages first="${f.pages.first}" last="${f.pages.last}"/>` : "      <pages/>"]
        : f.way === "attached"
          ? ["      <attached/>", ...(f.tooManyPages ? ["      <tooManyPages/>"] : [])]
          : ["      <held/>"]),
      "    </file>",
    ]),
    "  </appendix>",
  ];
}

/**
 * The values of the Record Data the layout decides, never the item: where things land on the
 * pages. Each is a pattern over recordDataXml's output and what it reads as in the facts. A
 * Re-produce (RP-155; decided by Main 2, 2026-10-19) may move these and nothing else.
 */
export const LAYOUT_DERIVED: readonly { readonly what: string; readonly pattern: RegExp; readonly as: string }[] = [
  { what: "the page the Review Comments start on", pattern: /(<comments) page="\d+"/g, as: "$1" },
  { what: "the page of the reply's full text", pattern: /\n *<replyFullText page="\d+"\/>/g, as: "" },
  { what: "the pages an appendix Document is on", pattern: /<pages first="\d+" last="\d+"\/>/g, as: "<pages/>" },
];

/** The facts of a Record Data document: its XML with the layout's values (LAYOUT_DERIVED) taken out. */
export function recordDataFacts(xml: string): string {
  return LAYOUT_DERIVED.reduce((facts, { pattern, as }) => facts.replace(pattern, as), xml);
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
    ...data.companies.flatMap((c) => [
      "    <company>",
      ...lang("name", c.name, "      "),
      ...lang("role", c.role, "      "),
      ...(c.logo ? [`      <logo${sha(c.logoSha256)}/>`] : []),
      "    </company>",
    ]),
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
    ...(data.reviewDays === null ? [] : [`    <reviewDays>${data.reviewDays}</reviewDays>`]),
    ...(data.cancellation ? cancellationXml(data.cancellation, "    ") : []),
    "  </decision>",
    ...(data.reply === null ? [] : [`  <reply>${escape(data.reply.text)}</reply>`]),
    ...(data.reply !== null && data.pages.reply !== null ? [`  <replyFullText page="${data.pages.reply}"/>`] : []),
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
    ...(data.comments.length > 0
      ? [
          `  <comments${data.pages.comments === null ? "" : ` page="${data.pages.comments}"`}>`,
          ...data.comments.flatMap((g) => [
            `    <author${at(g.at)}>`,
            ...lang("initials", g.initials, "      "),
            ...person(g.author, "      "),
            ...g.items.flatMap((c) => [
              `      <comment n="${c.n}">`,
              ...(c.documentNumber ? [`        <documentNumber>${escape(c.documentNumber)}</documentNumber>`] : []),
              `        <text>${escape(c.comment)}</text>`,
              ...(c.reference ? [`        <reference>${escape(c.reference)}</reference>`] : []),
              "      </comment>",
            ]),
            "    </author>",
          ]),
          "  </comments>",
        ]
      : []),
    "  <cards>",
    ...data.cards.flatMap((c, i) => [
      `    <card n="${i + 1}"${at(c.at)}>`,
      ...lang("verb", c.verb, "      "),
      ...lang("label", c.label, "      "),
      ...person(c, "      "),
      ...(c.signature ? [`      <signature${sha(c.signatureSha256)}/>`] : []),
      ...c.lines.flatMap((line) => [
        "      <answer>",
        ...lang("label", line.label, "        "),
        ...(line.kind === "text"
          ? lang("value", line.value, "        ")
          : line.items.flatMap((item, n) => lang("item", item, "        ", ` n="${n + 1}"`))),
        "      </answer>",
      ]),
      "    </card>",
    ]),
    "  </cards>",
    ...(data.nextStep
      ? data.nextStep.kind === "revision"
        ? [`  <nextStep revision="${data.nextStep.revisionNo}">`, "    <company>", ...lang("name", data.nextStep.company, "      "), "    </company>", "  </nextStep>"]
        : ["  <nextStep>", ...lang("replacement", pick(REPLACED, data.language), "    "), "  </nextStep>"]
      : []),
    "  <stamps>",
    ...data.stamps.flatMap((s) => [
      "    <stamp>",
      ...lang("name", s.company, "      "),
      ...lang("role", s.role, "      "),
      ...(s.image ? [`      <image${sha(s.imageSha256)}/>`] : []),
      "    </stamp>",
    ]),
    "  </stamps>",
    ...(data.disclaimer ? ["  <disclaimer>", ...lang("text", data.disclaimer, "    "), "  </disclaimer>"] : []),
    ...appendixXml(data.appendix),
    `  <verification code="${escape(data.verification.code)}" link="${escape(data.verification.link)}"/>`,
    "</recordData>",
    "",
  ];
  return lines.join("\n");
}
