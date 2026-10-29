import type { CardLine } from "./action-answers.ts";
import type { RecordBlock, RecordSection } from "./form-content.ts";
import {
  RECORD_DATA_NAMESPACE,
  isShortCode,
  type AppendixEntry,
  type Cancellation,
  type Chip,
  type CommentGroup,
  type CompanyLine,
  type FlowEntry,
  type FlowMark,
  type NextStep,
  type PersonLine,
  type RecordData,
  type RecordImages,
  type SignatureCard,
  type StampLine,
} from "./record-data.ts";
import type { RecordLanguage, RecordText } from "./record-text.ts";

// The Record Data read back (RP-155, Re-produce): the stored XML (record-data.ts writes it)
// as the RecordData the layout prints from, so a Re-produce remakes the PDF from the same
// Record Data and nothing else. Reads only the XML recordDataXml writes; anything else is
// refused. Whoever adds to recordDataXml extends this reader until its round trip test
// (record-data-read.test.ts, over the golden records) passes again.
//
// What the XML does not hold is derived, so that the same Record Data prints the same pages:
// - a photo's storage key comes from its fingerprint (`sha256`) among the item's Documents
//   (`PhotoKeys`); a photo with a fingerprint whose Document is not found fails the Re-produce;
// - an outcome's or a named chip's code: the layout prints a short code (A, B, C, D) as itself and
//   any other outcome by its name, which the XML holds, so a named one reads back as "named";
// - an outcome's look, which only marks the approval flow's last entry: read from that mark.

interface XmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  readonly text: string;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return entities[e] ?? whole;
  });

/** The elements, attributes and text of the small XML recordDataXml writes: no comments, CDATA or DTD. */
function parseXml(xml: string): XmlNode {
  const source = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const tag = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[A-Za-z][\w.:-]*="[^"]*")*)\s*(\/?)>/gy;
  const stack: { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }[] = [];
  let root: XmlNode | undefined;
  let at = 0;
  const close = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else root = node;
  };
  while (at < source.length) {
    const next = source.indexOf("<", at);
    const text = source.slice(at, next < 0 ? undefined : next);
    const top = stack[stack.length - 1];
    if (top) top.text += unescape(text);
    else if (text.trim() !== "") throw new Error("Record Data: text outside the root element");
    if (next < 0) break;
    tag.lastIndex = next;
    const m = tag.exec(source);
    if (!m) throw new Error("Record Data: not the XML recordDataXml writes");
    at = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = m as unknown as [string, string, string, string, string];
    if (closing) {
      const done = stack.pop();
      if (!done || done.name !== name) throw new Error(`Record Data: unexpected </${name}>`);
      // Text between child elements is layout, not content.
      close({ name: done.name, attrs: done.attrs, children: done.children, text: done.children.length > 0 ? "" : done.text });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([A-Za-z][\w.:-]*)="([^"]*)"/g)) attrs[a[1]!] = unescape(a[2]!);
    if (selfClosing) close({ name, attrs, children: [], text: "" });
    else stack.push({ name, attrs, children: [], text: "" });
  }
  if (stack.length > 0 || !root) throw new Error("Record Data: the XML is not complete");
  return root;
}

const children = (node: XmlNode, name: string): XmlNode[] => node.children.filter((c) => c.name === name);
const maybe = (node: XmlNode, name: string): XmlNode | undefined => node.children.find((c) => c.name === name);
const child = (node: XmlNode, name: string): XmlNode => {
  const found = maybe(node, name);
  if (!found) throw new Error(`Record Data: <${node.name}> has no <${name}>`);
  return found;
};
const attr = (node: XmlNode, name: string): string => {
  const value = node.attrs[name];
  if (value === undefined) throw new Error(`Record Data: <${node.name}> has no ${name}`);
  return value;
};

/** The text of the elements `nodes`, each in its language (`lang`). */
function textOfNodes(nodes: readonly XmlNode[]): RecordText {
  const out: { ar?: string; en?: string } = {};
  for (const n of nodes) {
    const l = n.attrs.lang;
    if (l !== "ar" && l !== "en") throw new Error(`Record Data: <${n.name}> has no language`);
    out[l] = n.text;
  }
  return out;
}

/** The text in the `<tag lang=…>` children of `node`. */
const textOf = (node: XmlNode, tag: string): RecordText => textOfNodes(children(node, tag));

export interface PhotoKeys {
  /** The storage key of the Document whose fingerprint (hex SHA-256) is `sha256`, or null. */
  keyOf(sha256: string): string | null;
}

/** The Record Data held in `xml`, the document recordDataXml wrote. */
export function parseRecordData(xml: string, photos: PhotoKeys = { keyOf: () => null }): RecordData {
  return parseRecord(xml, photos).data;
}

/**
 * The Record Data held in `xml`, and where the logos, Signatures and Stamps it prints are: each
 * found by its fingerprint through `photos` (null where it is not found, or the page printed none).
 */
export function parseRecord(xml: string, photos: PhotoKeys = { keyOf: () => null }): { data: RecordData; marks: RecordImages } {
  const root = parseXml(xml);
  if (root.name !== "recordData" || root.attrs.xmlns !== RECORD_DATA_NAMESPACE) throw new Error("Record Data: not a Record Data document of this version");
  const language = attr(root, "language");
  if (language !== "bilingual" && language !== "ar" && language !== "en") throw new Error(`Record Data: unknown language ${language}`);
  const lang = language as RecordLanguage;
  // A text is one element for each language the record prints.
  const per = lang === "bilingual" ? 2 : 1;
  const groups = (nodes: readonly XmlNode[]): RecordText[] => {
    const out: RecordText[] = [];
    for (let i = 0; i < nodes.length; i += per) out.push(textOfNodes(nodes.slice(i, i + per)));
    return out;
  };

  const personOf = (node: XmlNode): PersonLine => {
    const member = child(node, "member");
    return {
      name: textOf(member, "name"),
      positions: children(member, "position").map((p) => textOf(p, "name")),
      company: textOf(child(node, "company"), "name"),
      role: textOf(node, "role"),
    };
  };
  const companyLines = (node: XmlNode): CompanyLine[] => children(node, "company").map((c) => ({ name: textOf(c, "name"), role: textOf(c, "role") }));
  // A logo, Signature or Stamp the page prints is a flag, with its image's fingerprint.
  const flag = (node: XmlNode, name: string) => {
    const found = maybe(node, name);
    return { shown: found !== undefined, sha256: found?.attrs.sha256 ?? null };
  };
  const keyOfMark = (m: { shown: boolean; sha256: string | null }) => (m.shown && m.sha256 ? photos.keyOf(m.sha256) : null);
  const photoOf = (p: XmlNode) => {
    const sha256 = p.attrs.sha256 ?? null;
    return { fileName: p.text, takenAt: p.attrs.at ?? null, sha256, storageKey: (sha256 && photos.keyOf(sha256)) || "" };
  };

  const blockOf = (node: XmlNode): RecordBlock => {
    switch (node.name) {
      case "field":
        return { kind: "field", label: textOf(node, "label"), value: textOf(node, "value") };
      case "table": {
        const totals = maybe(node, "totals");
        return {
          kind: "table",
          label: textOf(node, "label"),
          columns: groups(children(child(node, "columns"), "column")),
          rows: children(node, "row").map((r) => groups(children(r, "cell"))),
          totals: totals ? groups(children(totals, "cell")) : null,
        };
      }
      case "checklist":
        return {
          kind: "checklist",
          label: textOf(node, "label"),
          summary: textOf(node, "summary"),
          items: children(node, "item").map((item) => ({
            text: textOf(item, "text"),
            answer: textOf(item, "answer"),
            comment: maybe(item, "comment")?.text ?? null,
            snag: maybe(item, "snag") ? textOf(item, "snag") : null,
            photos: children(item, "photo").map(photoOf),
          })),
        };
      case "photos":
        return { kind: "photos", label: textOf(node, "label"), photos: children(node, "photo").map(photoOf) };
      default:
        throw new Error(`Record Data: unknown block <${node.name}>`);
    }
  };
  const blocksOf = (nodes: readonly XmlNode[]): RecordBlock[] => nodes.map(blockOf);

  const item = child(root, "item");
  const type = child(item, "type");
  const outcome = child(item, "outcome");
  const revisionOf = maybe(item, "revisionOf");
  const classification = child(root, "classification");
  const decision = child(root, "decision");
  const transitions: FlowEntry[] = children(child(root, "transitions"), "transition").map((t) => ({
    ...personOf(t),
    label: textOf(t, "label"),
    at: attr(t, "at"),
    mark: attr(t, "mark") as FlowMark,
    contentSha256: t.attrs.contentSha256 ?? null,
  }));
  const closingMark = transitions.at(-1)?.mark;

  // A chip is its code when short (no text), else its name in each language.
  const chips: Chip[] = [];
  const chipNodes = children(decision, "chip");
  for (let i = 0; i < chipNodes.length; ) {
    const first = chipNodes[i]!;
    if (first.attrs.code !== undefined) {
      chips.push({ code: first.attrs.code, name: {}, issued: first.attrs.issued === "true" });
      i += 1;
    } else {
      chips.push({ code: "named", name: textOfNodes(chipNodes.slice(i, i + per)), issued: first.attrs.issued === "true" });
      i += per;
    }
  }

  const sections: RecordSection[] = children(child(root, "form"), "section").map((s) => ({
    title: textOf(s, "title"),
    blocks: blocksOf(s.children.filter((c) => c.name !== "title")),
  }));
  const classificationBlocks = classification.children.filter((c) => !["trades", "location", "scopes"].includes(c.name));
  const reply = maybe(root, "reply");
  const submitted = maybe(item, "submitted");
  const verification = child(root, "verification");
  const issuedBy = maybe(decision, "issuedBy");
  const confirmedBy = maybe(decision, "confirmedBy");
  const named = (node: XmlNode | undefined) => (node ? groups(children(node, "name")) : []);

  // A trade is its name in each language, selected or not.
  const tradeNodes = children(child(classification, "trades"), "trade");
  const trades: RecordData["trades"][number][] = [];
  for (let i = 0; i < tradeNodes.length; i += per) {
    trades.push({ name: textOfNodes(tradeNodes.slice(i, i + per)), selected: tradeNodes[i]!.attrs.selected === "true" });
  }

  // Page 1's logos, the review duration and a Cancel's who and why (RP-650).
  const companyNodes = children(child(root, "companies"), "company");
  const logos = companyNodes.map((c) => flag(c, "logo"));
  const companies: CompanyLine[] = companyNodes.map((c, i) => ({ name: textOf(c, "name"), role: textOf(c, "role"), logo: logos[i]!.shown, logoSha256: logos[i]!.sha256 }));
  const reviewDays = maybe(decision, "reviewDays");
  const cancelled = maybe(decision, "cancelled");
  const byRabaed = maybe(decision, "cancelledByRabaed");
  const cancellation: Cancellation | null = byRabaed
    ? { by: null, reason: null, companyLeft: textOf(child(byRabaed, "company"), "name") }
    : cancelled
      ? { by: maybe(cancelled, "by") ? personOf(child(cancelled, "by")) : null, reason: maybe(cancelled, "reason")?.text ?? null, companyLeft: null }
      : null;
  const replyFullText = maybe(root, "replyFullText");

  // The pages after page 1: the Comments, the cards, the Next step, the Stamps, the Disclaimer (RP-650).
  const commentsNode = maybe(root, "comments");
  const comments: CommentGroup[] = (commentsNode ? children(commentsNode, "author") : []).map((a) => ({
    author: personOf(a),
    initials: textOf(a, "initials"),
    at: attr(a, "at"),
    items: children(a, "comment").map((c) => ({
      n: Number(attr(c, "n")),
      documentNumber: maybe(c, "documentNumber")?.text ?? null,
      comment: child(c, "text").text,
      reference: maybe(c, "reference")?.text ?? null,
    })),
  }));
  const cardNodes = children(child(root, "cards"), "card");
  const signatures = cardNodes.map((c) => flag(c, "signature"));
  const cards: SignatureCard[] = cardNodes.map((c, i) => ({
    ...personOf(c),
    verb: textOf(c, "verb"),
    label: textOf(c, "label"),
    at: attr(c, "at"),
    signature: signatures[i]!.shown,
    signatureSha256: signatures[i]!.sha256,
    lines: children(c, "answer").map((a): CardLine => {
      const values = children(a, "value");
      if (values.length > 0) return { kind: "text", label: textOf(a, "label"), value: textOfNodes(values) };
      const items = children(a, "item");
      const ns = [...new Set(items.map((n) => attr(n, "n")))];
      return { kind: "list", label: textOf(a, "label"), items: ns.map((n) => textOfNodes(items.filter((x) => x.attrs.n === n))) };
    }),
  }));
  const nextNode = maybe(root, "nextStep");
  const nextStep: NextStep | null = !nextNode
    ? null
    : nextNode.attrs.revision !== undefined
      ? { kind: "revision", revisionNo: Number(nextNode.attrs.revision), company: textOf(child(nextNode, "company"), "name") }
      : { kind: "replacement" };
  const stampNodes = children(child(root, "stamps"), "stamp");
  const stampMarks = stampNodes.map((s) => flag(s, "image"));
  const stamps: StampLine[] = stampNodes.map((s, i) => ({ company: textOf(s, "name"), role: textOf(s, "role"), image: stampMarks[i]!.shown, imageSha256: stampMarks[i]!.sha256 }));
  const disclaimer = maybe(root, "disclaimer");

  // The appendix (RP-147): each file by name and fingerprint, and how the record holds it.
  const appendixNode = maybe(root, "appendix");
  const appendix: AppendixEntry[] = (appendixNode ? children(appendixNode, "file") : []).map((f) => {
    const file = { fileName: child(f, "name").text, sha256: attr(f, "sha256") };
    const pages = maybe(f, "pages");
    if (pages) {
      const range = pages.attrs.first === undefined ? null : { first: Number(attr(pages, "first")), last: Number(attr(pages, "last")) };
      if (!range) throw new Error("Record Data: an appendix file's pages are not placed");
      return { ...file, way: "pages", pageCount: range.last - range.first + 1, pages: range };
    }
    if (maybe(f, "attached")) return { ...file, way: "attached", tooManyPages: maybe(f, "tooManyPages") !== undefined };
    if (maybe(f, "held")) return { ...file, way: "held" };
    throw new Error("Record Data: an appendix file is neither pages, attached nor held");
  });

  const code = outcome.attrs.code;
  const data: RecordData = {
    layoutVersion: attr(root, "layoutVersion"),
    language: lang,
    hijri: attr(root, "hijri") === "true",
    projectName: textOf(child(root, "project"), "name"),
    type: { code: attr(type, "code"), name: textOf(type, "name") },
    documentNumber: child(item, "documentNumber").text === "" ? null : child(item, "documentNumber").text,
    revisionNo: Number(child(item, "revision").text),
    revisionOf: revisionOf ? { documentNumber: revisionOf.text, closedAt: attr(revisionOf, "at"), outcome: attr(revisionOf, "outcome") } : null,
    subject: child(item, "subject").text,
    outcome: {
      // Only a short code is written (A, B, C, D); any other outcome prints its name.
      code: code !== undefined && isShortCode(code) ? code : "named",
      name: textOf(outcome, "name"),
      look: closingMark === "revise" ? "c" : closingMark === "rejected" ? "d" : null,
    },
    closedAt: attr(outcome, "at"),
    submittedAt: submitted ? attr(submitted, "at") : null,
    chips,
    issuedBy: issuedBy ? personOf(issuedBy) : null,
    confirmedBy: confirmedBy ? personOf(confirmedBy) : null,
    reviewComments: Number(child(decision, "reviewComments").text),
    companies,
    // eslint-disable-next-line rabaed/no-avoid-terms -- the Record Data's stored element name (record-data.ts keeps it).
    participants: companyLines(child(root, "parties")),
    trades,
    location: named(maybe(classification, "location")),
    scopes: named(maybe(classification, "scopes")),
    classification: blocksOf(classificationBlocks),
    // Cut short when page 1 points to its full text; the "…" it ends with says so too (a record with no cards).
    reply: reply ? { text: reply.text, cut: replyFullText !== undefined || reply.text.endsWith("…") } : null,
    transitions,
    sections,
    documents: children(child(root, "documents"), "document").map((d) => ({ fileName: d.text, pages: d.attrs.pages === undefined ? null : Number(d.attrs.pages) })),
    verification: { code: attr(verification, "code"), link: attr(verification, "link") },
    reviewDays: reviewDays ? Number(reviewDays.text) : null,
    cancellation,
    comments,
    cards,
    nextStep,
    stamps,
    disclaimer: disclaimer ? textOf(disclaimer, "text") : null,
    pages: {
      comments: commentsNode?.attrs.page === undefined ? null : Number(commentsNode.attrs.page),
      reply: replyFullText ? Number(attr(replyFullText, "page")) : null,
    },
    appendix,
  };
  return {
    data,
    marks: { logos: logos.map(keyOfMark), signatures: signatures.map(keyOfMark), stamps: stampMarks.map(keyOfMark) },
  };
}
