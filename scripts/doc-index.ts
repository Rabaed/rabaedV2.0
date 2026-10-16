// The long design docs open with a contents index (RP-538): every ## and ###
// heading with a one-line "read when …" hint, so an implementer greps the
// headings and Reads only the part under one instead of the whole doc (the
// RP-448/449 implementers read 1.2 MB of docs, whole, for one part each). No
// line numbers: they go stale. Checked by scripts/doc-index.test.ts, in the unit
// project, so a heading added, renamed or moved without its index entry fails.
//
// Index format, right after the doc's title and intro:
//   ## Contents
//   - **<## heading text>**: read when …
//     - **<### heading text>**: read when …

/** The docs that carry a contents index. */
export const indexedDocs = ["docs/workflow-engine.md", "docs/visibility.md", "docs/form-engine.md", "docs/data-model.md"];

const indexHeading = "## Contents";
const isIndexHeading = (line: string) => line.trimEnd() === indexHeading;

export type Heading = { level: 2 | 3; text: string };
export type Entry = Heading & { hint: string };
type Parsed = { hasIndex: boolean; headings: Heading[]; entries: Entry[]; malformed: string[] };

/** The doc's lines outside fenced code blocks. */
function proseLines(markdown: string): string[] {
  let fenced = false;
  return markdown.split("\n").filter((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return !fenced && !line.startsWith("```");
  });
}

function parse(markdown: string): Parsed {
  const lines = proseLines(markdown);
  const headings = lines.flatMap((line): Heading[] => {
    const match = /^(#{2,3}) (.+?)\s*$/.exec(line);
    return match && !isIndexHeading(line) ? [{ level: match[1]!.length === 2 ? 2 : 3, text: match[2]! }] : [];
  });
  const start = lines.findIndex(isIndexHeading);
  const entries: Entry[] = [];
  const malformed: string[] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("#")) break;
      const match = /^( *)- \*\*(.+?)\*\*: (.*)$/.exec(line);
      if (match) entries.push({ level: match[1]!.length >= 2 ? 3 : 2, text: match[2]!, hint: match[3]!.trim() });
      else if (/^ *- /.test(line)) malformed.push(line.trim());
    }
  }
  return { hasIndex: start >= 0, headings, entries, malformed };
}

/** The ## and ### headings, in order, outside code fences; the index's own heading is left out. */
export const docHeadings = (markdown: string): Heading[] => parse(markdown).headings;

/** The index's entries: `- **text**: hint` is a ## heading's, indented by two spaces a ###'s. */
export const indexEntries = (markdown: string): Entry[] => parse(markdown).entries;

/** What is wrong with a doc's index against its headings; empty when it matches. */
export function indexProblems(file: string, markdown: string): string[] {
  const { hasIndex, headings, entries, malformed } = parse(markdown);
  if (!hasIndex) return [`${file} has no \`${indexHeading}\` index at the top`];
  const hashes = (level: number) => "#".repeat(level);
  const count = (items: Heading[], text: string) => items.filter((item) => item.text === text).length;
  // Counted, not just looked up, so a heading whose text appears twice needs two entries.
  const lacking = headings.filter((h, i) => count(headings.slice(0, i + 1), h.text) > count(entries, h.text));
  const problems = [
    ...malformed.map((line) => `${file}: the index line "${line}" is not \`- **<heading>**: read when …\``),
    ...lacking.map((h) => `${file}: the index lacks "${hashes(h.level)} ${h.text}"`),
    ...entries.filter((e) => count(headings, e.text) === 0).map((e) => `${file}: the index lists "${hashes(e.level)} ${e.text}", which is not a heading`),
    ...entries.flatMap((e) => {
      const heading = headings.find((h) => h.text === e.text);
      return heading && heading.level !== e.level ? [`${file}: the index lists "${e.text}" as ${hashes(e.level)}, but it is a ${hashes(heading.level)} heading`] : [];
    }),
    ...entries.filter((e) => !e.hint.startsWith("read when")).map((e) => `${file}: the entry "${e.text}" needs a hint starting "read when"`),
  ];
  if (problems.length === 0 && entries.map((e) => e.text).join("\n") !== headings.map((h) => h.text).join("\n")) {
    problems.push(`${file}: the index is not in the headings' order`);
  }
  return problems;
}
