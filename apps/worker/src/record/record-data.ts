import type { RecordFacts, TransitionFact } from "@rabaed/db";
import type { BilingualText } from "@rabaed/domain";

// The Record Data (ADR 0023; workflow-engine.md §7; form-engine.md §6): one XML
// document holding exactly what the Documental Record prints, written once when
// the item closes and never changed. The PDF is made from it alone, and it
// travels inside the PDF, so it holds nothing the pages don't print.
//
// This first version (RP-620, the tracer) holds the item's identity and outcome
// and every Transition on its path. RP-151 and RP-650 add page 1, the Form,
// Signatures, Stamps and Review Comments; RP-147 the Documents.

/** The layout version the Record Data is printed with (layout.ts). */
export const LAYOUT_VERSION = "1";

/** Record Data's XML namespace, versioned with its shape. */
export const RECORD_DATA_NAMESPACE = "https://rabaed.com/ns/record-data/1";

/** One Transition taken on the item, and what the database gives the job about the closed item (app.documental_record_facts). */
export type { RecordFacts, TransitionFact };

export interface RecordData {
  readonly layoutVersion: string;
  readonly language: "bilingual";
  readonly projectName: BilingualText;
  readonly type: RecordFacts["type"];
  readonly documentNumber: string | null;
  readonly revisionNo: number;
  readonly subject: string;
  readonly outcome: string;
  readonly closedAt: string;
  /** The Transitions on the path to the outcome (recordPath). */
  readonly transitions: readonly TransitionFact[];
  /** The short code printed on every page, and the verification page's long link. */
  readonly verification: { readonly code: string; readonly link: string };
}

/**
 * The Transitions on the item's path to its outcome (V7): a Return, a Send
 * Back, or a Code the Owner sent back makes a loop that comes back to a Step
 * the item left before; the loop and the work around it are left out, so each
 * Step appears once, as the item last left it.
 */
export function recordPath(transitions: readonly TransitionFact[]): TransitionFact[] {
  const path: TransitionFact[] = [];
  for (const t of transitions) {
    const back = path.findIndex((p) => p.fromStepId === t.fromStepId);
    if (back >= 0) path.length = back;
    path.push(t);
  }
  return path;
}

export function recordDataOf(facts: RecordFacts, verification: RecordData["verification"]): RecordData {
  return {
    layoutVersion: LAYOUT_VERSION,
    language: "bilingual",
    projectName: facts.projectName,
    type: facts.type,
    documentNumber: facts.documentNumber,
    revisionNo: facts.revisionNo,
    subject: facts.subject,
    outcome: facts.outcome,
    closedAt: facts.closedAt,
    transitions: recordPath(facts.transitions),
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

const bilingual = (tag: string, text: BilingualText, indent: string) =>
  `${indent}<${tag} lang="ar">${escape(text.ar)}</${tag}>\n${indent}<${tag} lang="en">${escape(text.en)}</${tag}>`;

/** The Record Data as its XML document. */
export function recordDataXml(data: RecordData): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<recordData xmlns="${RECORD_DATA_NAMESPACE}" layoutVersion="${escape(data.layoutVersion)}" language="${data.language}">`,
    "  <project>",
    bilingual("name", data.projectName, "    "),
    "  </project>",
    "  <item>",
    `    <type code="${escape(data.type.code)}">`,
    bilingual("name", data.type.name, "      "),
    "    </type>",
    data.documentNumber === null ? "    <documentNumber/>" : `    <documentNumber>${escape(data.documentNumber)}</documentNumber>`,
    `    <revision>${data.revisionNo}</revision>`,
    `    <subject>${escape(data.subject)}</subject>`,
    `    <outcome code="${escape(data.outcome)}" at="${escape(data.closedAt)}"/>`,
    "  </item>",
    "  <transitions>",
    ...data.transitions.flatMap((t, i) => [
      `    <transition n="${i + 1}" at="${escape(t.at)}"${t.contentSha256 ? ` contentSha256="${escape(t.contentSha256)}"` : ""}>`,
      bilingual("label", t.label, "      "),
      "      <member>",
      bilingual("name", t.memberName, "        "),
      ...t.positions.map((p) => `        <position>\n${bilingual("name", p, "          ")}\n        </position>`),
      "      </member>",
      "      <company>",
      bilingual("name", t.companyName, "        "),
      "      </company>",
      "    </transition>",
    ]),
    "  </transitions>",
    `  <verification code="${escape(data.verification.code)}" link="${escape(data.verification.link)}"/>`,
    "</recordData>",
    "",
  ];
  return lines.join("\n");
}
