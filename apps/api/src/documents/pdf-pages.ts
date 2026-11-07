import { inflateSync } from "node:zlib";

// A PDF's page count (RP-1189), read from the stored file's bytes when its upload is confirmed, for the
// Submittal Panel's file cards. It follows the document's own structure: the trailer's /Root, the
// Catalog's /Pages, and that page tree's /Count, whether the objects are plain or packed in compressed
// object streams (PDF 1.5+). A later definition of an object (an incremental update) wins. Anything it
// can't follow (not a PDF, damaged, encrypted object streams) gives none: the card then shows no count
// until the browser's pdf.js reads the file.

/** The most pages a count is believed for: beyond it the file is taken as unreadable. */
const maxPages = 100_000;

/** The pages of the PDF in `bytes`; null when they can't be read. */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    return count(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return null;
  }
}

function count(file: Buffer): number | null {
  const text = file.toString("latin1");
  if (!text.slice(0, 1024).includes("%PDF-")) return null;
  const objects = plainObjects(text);
  for (const body of [...objects.values()]) if (/\/Type\s*\/ObjStm\b/.test(body)) addPacked(objects, body, file, text);

  const roots = [...text.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  const rootNo = roots.length > 0 ? Number(roots[roots.length - 1]![1]) : null;
  const catalog = (rootNo !== null ? objects.get(rootNo) : undefined) ?? [...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body));
  const pagesNo = catalog && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog);
  const tree = pagesNo ? objects.get(Number(pagesNo[1])) : undefined;
  const found = tree && /\/Count\s+(\d+)/.exec(dictionaryOf(tree));
  if (!found) return null;
  const pages = Number(found[1]);
  return pages > 0 && pages <= maxPages ? pages : null;
}

/** Each `n g obj … endobj` in the file by its number; a later one (an incremental update) replaces an earlier. */
function plainObjects(text: string): Map<number, string> {
  const objects = new Map<number, string>();
  for (const match of text.matchAll(/(?:^|[\s>\]])(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g)) objects.set(Number(match[1]), match[2]!);
  return objects;
}

/** The objects packed in object stream `body` (PDF 1.5 §7.5.7), for each number no plain object defines. */
function addPacked(objects: Map<number, string>, body: string, file: Buffer, text: string): void {
  const dictionary = dictionaryOf(body);
  const n = Number(/\/N\s+(\d+)/.exec(dictionary)?.[1]);
  const first = Number(/\/First\s+(\d+)/.exec(dictionary)?.[1]);
  if (!Number.isInteger(n) || !Number.isInteger(first)) return;
  const data = streamData(body, dictionary, file, text);
  if (!data) return;
  const decoded = (/\/FlateDecode\b/.test(dictionary) ? inflateSync(data) : data).toString("latin1");
  const header = decoded.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < n; i++) {
    const number = header[2 * i]!;
    const start = first + header[2 * i + 1]!;
    const end = i + 1 < n ? first + header[2 * i + 3]! : decoded.length;
    if (!Number.isInteger(number) || objects.has(number)) continue;
    objects.set(number, decoded.slice(start, end));
  }
}

/** A stream object's raw bytes: its direct /Length after `stream`, or up to `endstream`. */
function streamData(body: string, dictionary: string, file: Buffer, text: string): Buffer | null {
  const keyword = /stream\r?\n/.exec(body.slice(dictionary.length));
  if (!keyword) return null;
  // Where this body sits in the file, so the bytes are cut from the Buffer, not the text.
  const at = text.indexOf(body);
  if (at < 0) return null;
  const start = at + dictionary.length + keyword.index + keyword[0].length;
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary);
  if (length) return file.subarray(start, start + Number(length[1]));
  const end = text.indexOf("endstream", start);
  return end < 0 ? null : file.subarray(start, end);
}

/** The object's outer dictionary, `<< … >>` with its nested ones, without what follows it (a stream). */
function dictionaryOf(body: string): string {
  const open = body.indexOf("<<");
  if (open < 0) return body;
  let depth = 0;
  for (let i = open; i < body.length - 1; i++) {
    if (body[i] === "<" && body[i + 1] === "<") {
      depth++;
      i++;
    } else if (body[i] === ">" && body[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) return body.slice(0, i + 1);
    }
  }
  return body;
}
