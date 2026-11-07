import { inflateSync } from "node:zlib";

// A PDF's page count (RP-1189), read from the stored file's bytes when its upload is confirmed, for the
// Submittal Panel's file cards. It follows the document's own structure: the trailer's /Root, the
// Catalog's /Pages, and that page tree's /Count, whether the objects are plain or packed in compressed
// object streams (PDF 1.5+). A later definition of an object (an incremental update) wins. Anything it
// can't follow (not a PDF, damaged, encrypted, over the size caps) gives none, never an error: the
// upload goes on, and the card shows no count until the browser's pdf.js reads the file.
//
// Hand-written, not a PDF library: apps/api takes no new runtime dependency for one number (RP-1189).

/** The most pages a count is believed for: beyond it the file is taken as unreadable. */
const MAX_PAGES = 100_000;
/** The largest file it reads; a larger one gets no count, and the caller needn't read its bytes. */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
/** The most bytes it inflates from all of a file's object streams together: no unbounded inflate. */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/** The pages of the PDF in `bytes`; null when they can't be read. Never throws. */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  if (bytes.byteLength > MAX_PDF_BYTES) return null;
  try {
    return count(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return null;
  }
}

function count(file: Buffer): number | null {
  const text = file.toString("latin1");
  if (!text.slice(0, 1024).includes("%PDF-")) return null;
  // An encrypted file's structure is not read without its password: no count.
  if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text)) return null;
  const { objects, streams } = plainObjects(text);
  const budget = { left: MAX_INFLATED_BYTES };
  for (const stream of streams) addPacked(objects, stream, file, text, budget);

  const roots = [...text.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  const rootNo = roots.length > 0 ? Number(roots[roots.length - 1]![1]) : null;
  const catalog = (rootNo !== null ? objects.get(rootNo) : undefined) ?? [...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body));
  const pagesNo = catalog && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog);
  const tree = pagesNo ? objects.get(Number(pagesNo[1])) : undefined;
  const found = tree && /\/Count\s+(\d+)/.exec(dictionaryOf(tree));
  if (!found) return null;
  const pages = Number(found[1]);
  return pages > 0 && pages <= MAX_PAGES ? pages : null;
}

/** An object's body as the file has it, and where in the file that body starts. */
type Placed = { body: string; at: number };

/**
 * Each `n g obj … endobj` in the file by its number, a later one (an incremental update) replacing an
 * earlier; and the object streams among them, each with where its body starts in the file.
 */
function plainObjects(text: string): { objects: Map<number, string>; streams: Placed[] } {
  const objects = new Map<number, string>();
  const streams: Placed[] = [];
  for (const match of text.matchAll(/(?:^|[\s>\]])(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g)) {
    const body = match[2]!;
    objects.set(Number(match[1]), body);
    if (/\/Type\s*\/ObjStm\b/.test(body)) streams.push({ body, at: match.index + match[0].length - "endobj".length - body.length });
  }
  return { objects, streams };
}

/** The objects packed in object stream `stream` (PDF 1.5 §7.5.7), for each number no plain object defines. */
function addPacked(objects: Map<number, string>, { body, at }: Placed, file: Buffer, text: string, budget: { left: number }): void {
  const dictionary = dictionaryOf(body);
  const n = Number(/\/N\s+(\d+)/.exec(dictionary)?.[1]);
  const first = Number(/\/First\s+(\d+)/.exec(dictionary)?.[1]);
  if (!Number.isInteger(n) || !Number.isInteger(first)) return;
  const data = streamData(body, at, dictionary, file, text);
  if (!data) return;
  // Inflated within what is left of the file's budget: past it inflateSync throws, and the count is none.
  if (budget.left <= 0) throw new RangeError("object streams over the inflate cap");
  const raw = /\/FlateDecode\b/.test(dictionary) ? inflateSync(data, { maxOutputLength: budget.left }) : data;
  budget.left -= raw.length;
  const decoded = raw.toString("latin1");
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
function streamData(body: string, at: number, dictionary: string, file: Buffer, text: string): Buffer | null {
  const keyword = /stream\r?\n/.exec(body.slice(dictionary.length));
  if (!keyword) return null;
  // `at` is where the body starts in the file (latin1: one byte a character), so the bytes are cut from the Buffer.
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
