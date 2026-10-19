import type { BilingualText } from "@rabaed/domain";
import { RECORD_DATA_NAMESPACE, type RecordData, type TransitionFact } from "./record-data.ts";

// The Record Data read back (RP-155, Re-produce): the stored XML (record-data.ts writes it)
// as the RecordData the layout prints from, so a Re-produce remakes the PDF from the same
// Record Data and nothing else. Reads only the XML recordDataXml writes; anything else is
// refused. When a later ticket adds to recordDataXml, the round trip test
// (record-data-read.test.ts) says so until this reads it too.

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
  while (at < source.length) {
    const next = source.indexOf("<", at);
    const text = source.slice(at, next < 0 ? undefined : next);
    if (text.trim() !== "") {
      const top = stack[stack.length - 1];
      if (!top) throw new Error("Record Data: text outside the root element");
      top.text += unescape(text);
    }
    if (next < 0) break;
    tag.lastIndex = next;
    const m = tag.exec(source);
    if (!m) throw new Error("Record Data: not the XML recordDataXml writes");
    at = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = m as unknown as [string, string, string, string, string];
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`Record Data: unexpected </${name}>`);
      const node: XmlNode = { name: top.name, attrs: top.attrs, children: top.children, text: top.text };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else root = node;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([A-Za-z][\w.:-]*)="([^"]*)"/g)) attrs[a[1]!] = unescape(a[2]!);
    if (selfClosing) {
      const node: XmlNode = { name, attrs, children: [], text: "" };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else root = node;
    } else {
      stack.push({ name, attrs, children: [], text: "" });
    }
  }
  if (stack.length > 0 || !root) throw new Error("Record Data: the XML is not complete");
  return root;
}

const child = (node: XmlNode, name: string): XmlNode => {
  const found = node.children.find((c) => c.name === name);
  if (!found) throw new Error(`Record Data: <${node.name}> has no <${name}>`);
  return found;
};
const attr = (node: XmlNode, name: string): string => {
  const value = node.attrs[name];
  if (value === undefined) throw new Error(`Record Data: <${node.name}> has no ${name}`);
  return value;
};

/** The `<tag lang="ar">` and `<tag lang="en">` children of `node` named `tag`. */
function bilingualOf(node: XmlNode, tag: string): BilingualText {
  const text = (lang: string) => {
    const found = node.children.find((c) => c.name === tag && c.attrs.lang === lang);
    if (!found) throw new Error(`Record Data: <${node.name}> has no <${tag} lang="${lang}">`);
    return found.text;
  };
  return { ar: text("ar"), en: text("en") };
}

/** The Record Data held in `xml`, the document recordDataXml wrote. */
export function parseRecordData(xml: string): RecordData {
  const root = parseXml(xml);
  if (root.name !== "recordData" || root.attrs.xmlns !== RECORD_DATA_NAMESPACE) throw new Error("Record Data: not a Record Data document of this version");
  const language = attr(root, "language");
  if (language !== "bilingual") throw new Error(`Record Data: language ${language} is not one this layout prints`);
  const item = child(root, "item");
  const type = child(item, "type");
  const number = child(item, "documentNumber").text;
  const outcome = child(item, "outcome");
  const verification = child(root, "verification");
  const transitions: TransitionFact[] = child(root, "transitions").children.map((t) => {
    const member = child(t, "member");
    const hash = t.attrs.contentSha256;
    return {
      // The path holds no Step or kind the layout prints: the Record Data keeps neither.
      kind: "",
      fromStepId: "",
      toStepId: "",
      label: bilingualOf(t, "label"),
      at: attr(t, "at"),
      memberName: bilingualOf(member, "name"),
      positions: member.children.filter((c) => c.name === "position").map((p) => bilingualOf(p, "name")),
      companyName: bilingualOf(child(t, "company"), "name"),
      contentSha256: hash ?? null,
    };
  });
  return {
    layoutVersion: attr(root, "layoutVersion"),
    language,
    projectName: bilingualOf(child(root, "project"), "name"),
    type: { code: attr(type, "code"), name: bilingualOf(type, "name") },
    documentNumber: number === "" ? null : number,
    revisionNo: Number(child(item, "revision").text),
    subject: child(item, "subject").text,
    outcome: attr(outcome, "code"),
    closedAt: attr(outcome, "at"),
    transitions,
    verification: { code: attr(verification, "code"), link: attr(verification, "link") },
  };
}
