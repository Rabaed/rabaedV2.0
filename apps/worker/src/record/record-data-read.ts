import type { RecordBlock, RecordSection } from "./form-content.ts";
import { RECORD_DATA_NAMESPACE, isShortCode, type Chip, type CompanyLine, type FlowEntry, type FlowMark, type PersonLine, type RecordData } from "./record-data.ts";
import type { RecordLanguage, RecordText } from "./record-text.ts";

// The Record Data read back (RP-155, Re-produce): the stored XML (record-data.ts writes it)
// as the RecordData the layout prints from, so a Re-produce remakes the PDF from the same
// Record Data and nothing else. Reads only the XML recordDataXml writes; anything else is
// refused. Whoever adds to recordDataXml extends this reader until its round trip test
// (record-data-read.test.ts, over the golden records) passes again.
//
// What the XML never holds comes back empty: a photo's storage key (the Re-produce finds it
// among the item's Documents by name and time, `PhotoKeys`), an outcome's or a named chip's
// code (only its name is printed), and an outcome's look.

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
  /** The storage key of the Document a photo of this name and time is, or null. */
  keyOf(fileName: string, takenAt: string | null): string | null;
}

/** The Record Data held in `xml`, the document recordDataXml wrote. */
export function parseRecordData(xml: string, photos: PhotoKeys = { keyOf: () => null }): RecordData {
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
  const photoOf = (p: XmlNode) => {
    const takenAt = p.attrs.at ?? null;
    return { fileName: p.text, takenAt, storageKey: photos.keyOf(p.text, takenAt) ?? "" };
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

  const code = outcome.attrs.code;
  return {
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
    companies: companyLines(child(root, "companies")),
    parties: companyLines(child(root, "parties")),
    trades,
    location: named(maybe(classification, "location")),
    scopes: named(maybe(classification, "scopes")),
    classification: blocksOf(classificationBlocks),
    reply: reply ? reply.text : null,
    transitions,
    sections,
    documents: children(child(root, "documents"), "document").map((d) => ({ fileName: d.text, pages: d.attrs.pages === undefined ? null : Number(d.attrs.pages) })),
    verification: { code: attr(verification, "code"), link: attr(verification, "link") },
  };
}
