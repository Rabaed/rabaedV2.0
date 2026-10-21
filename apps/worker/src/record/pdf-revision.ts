import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObject, PDFObjectParser, PDFRef } from "pdf-lib";

// A PDF's last revision, read object by object through its cross-reference tables, and
// incremental updates written after it (RP-1006). The seal appends to a record of up to about
// 100 MB and checks it without parsing the whole file or writing it again: only the objects it
// reads are parsed, and nothing before the update is copied. Classic cross-reference tables
// only, as toPdfA3 and the seal write them.

const latin1 = new TextDecoder("latin1");
export const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
/** A Buffer over the same memory, for indexOf: no copy. */
export const bufferOf = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export interface Revision {
  /** Where its cross-reference table starts. */
  readonly startxref: number;
  /** The largest object number in use, in this revision or an earlier one. */
  readonly largestObjectNumber: number;
  readonly root: PDFRef;
  readonly info: PDFRef | undefined;
  readonly id: PDFArray | undefined;
  readonly context: PDFContext;
  /** The object `ref` names in this revision; throws when there is none. */
  resolve(ref: PDFRef): PDFObject;
}

interface Entry {
  readonly offset: number;
  readonly generation: number;
}

/** One cross-reference table at `at` and its trailer, or null when `at` holds no classic table (a cross-reference stream). */
function section(pdf: Uint8Array, at: number, context: PDFContext): { entries: [number, Entry | null][]; trailer: PDFDict } | null {
  if (latin1.decode(pdf.subarray(at, at + 4)) !== "xref") return null;
  const trailerAt = bufferOf(pdf).indexOf("trailer", at, "latin1");
  if (trailerAt < 0) throw new Error("a cross-reference table has no trailer");
  const tokens = latin1.decode(pdf.subarray(at + 4, trailerAt)).trim().split(/\s+/);
  const entries: [number, Entry | null][] = [];
  for (let i = 0; i < tokens.length; ) {
    const first = Number(tokens[i++]);
    const count = Number(tokens[i++]);
    if (!Number.isInteger(first) || !Number.isInteger(count) || count < 0) throw new Error("a cross-reference table does not read");
    for (let k = 0; k < count; k++) {
      const offset = Number(tokens[i++]);
      const generation = Number(tokens[i++]);
      const kind = tokens[i++];
      if (!Number.isInteger(offset) || !Number.isInteger(generation) || (kind !== "n" && kind !== "f")) throw new Error("a cross-reference table does not read");
      entries.push([first + k, kind === "n" ? { offset, generation } : null]);
    }
  }
  const trailer = PDFObjectParser.forBytes(pdf.subarray(trailerAt + "trailer".length), context).parseObject();
  if (!(trailer instanceof PDFDict)) throw new Error("a trailer is not a dictionary");
  return { entries, trailer };
}

/**
 * The last revision of `pdf`, read from its cross-reference tables (newest first, by /Prev):
 * null when its last one is a cross-reference stream. Throws when they do not read.
 */
export function lastRevision(pdf: Uint8Array): Revision | null {
  const tail = latin1.decode(pdf.subarray(Math.max(0, pdf.length - 1024)));
  const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!end) throw new Error("no cross-reference table");
  const startxref = Number(end[1]);
  const context = PDFContext.create();
  const entries = new Map<number, Entry | null>();
  let trailer: PDFDict | undefined;
  const seen = new Set<number>();
  for (let at: number | undefined = startxref; at !== undefined; ) {
    if (seen.has(at)) throw new Error("the cross-reference tables loop");
    seen.add(at);
    const read = section(pdf, at, context);
    if (!read) {
      if (at === startxref) return null;
      throw new Error("an earlier cross-reference table is a stream");
    }
    // The newest table says which offset an object has.
    for (const [n, entry] of read.entries) if (!entries.has(n)) entries.set(n, entry);
    trailer ??= read.trailer;
    const prev = read.trailer.get(PDFName.of("Prev"));
    at = prev instanceof PDFNumber ? prev.asNumber() : undefined;
  }
  const root = trailer!.get(PDFName.of("Root"));
  if (!(root instanceof PDFRef)) throw new Error("the trailer names no catalog");
  const info = trailer!.get(PDFName.of("Info"));
  const id = trailer!.get(PDFName.of("ID"));
  let largestObjectNumber = 0;
  for (const [n, entry] of entries) if (entry && n > largestObjectNumber) largestObjectNumber = n;
  return {
    startxref,
    largestObjectNumber,
    root,
    info: info instanceof PDFRef ? info : undefined,
    id: id instanceof PDFArray ? id : undefined,
    context,
    resolve(ref) {
      const entry = entries.get(ref.objectNumber);
      if (!entry || entry.generation !== ref.generationNumber) throw new Error(`no object ${ref.toString()}`);
      const head = /^\s*(\d+)\s+(\d+)\s+obj/.exec(latin1.decode(pdf.subarray(entry.offset, entry.offset + 48)));
      if (!head || Number(head[1]) !== ref.objectNumber || Number(head[2]) !== ref.generationNumber) throw new Error(`object ${ref.toString()} is not where the table says`);
      return PDFObjectParser.forBytes(pdf.subarray(entry.offset + head[0].length), context).parseObject();
    },
  };
}

/** `ref`'s object, as `type`; throws when it is another. */
export function resolveAs<T extends PDFObject>(revision: Revision, ref: PDFObject | undefined, type: { readonly prototype: T; readonly name: string }): T {
  const object = ref instanceof PDFRef ? revision.resolve(ref) : ref;
  // pdf-lib's object classes hide their constructors, so `type` is typed by its prototype.
  if (!(object instanceof (type as unknown as abstract new () => T))) throw new Error(`not a ${type.name}`);
  return object;
}

export interface IndirectObject {
  readonly ref: PDFRef;
  /** What goes between `n g obj` and `endobj`. */
  readonly body: Uint8Array;
}

export interface Update {
  /** The update's bytes, to append to the file it follows. */
  readonly bytes: Uint8Array;
  /** Where each object's body starts in the whole file, in the order given. */
  readonly bodyAt: readonly number[];
  /** The revision the update makes. */
  readonly revision: Revision;
}

/**
 * An incremental update after `revision`, whose file is `length` bytes: `objects` in the order
 * given, then a cross-reference table and a trailer pointing back to it. Byte for byte as the
 * seal's Document Security Store update has been written since RP-620.
 */
export function incrementalUpdate(revision: Revision, length: number, objects: readonly IndirectObject[]): Update {
  const parts: Uint8Array[] = [ascii("\n")];
  let offset = length + 1;
  const bodyAt: number[] = [];
  const offsets: [number, number, number][] = [];
  for (const { ref, body } of objects) {
    offsets.push([ref.objectNumber, ref.generationNumber, offset]);
    const head = ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const tail = ascii("\nendobj\n");
    bodyAt.push(offset + head.length);
    parts.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  }
  const xrefAt = offset;
  const lines = ["xref", "0 1", "0000000000 65535 f\r"];
  for (const [n, g, at] of offsets.toSorted((a, b) => a[0] - b[0])) {
    lines.push(`${n} 1`, `${String(at).padStart(10, "0")} ${String(g).padStart(5, "0")} n\r`);
  }
  const largestObjectNumber = Math.max(revision.largestObjectNumber, ...objects.map((o) => o.ref.objectNumber));
  const trailer = PDFDict.withContext(revision.context);
  trailer.set(PDFName.of("Size"), PDFNumber.of(largestObjectNumber + 1));
  trailer.set(PDFName.of("Root"), revision.root);
  if (revision.info) trailer.set(PDFName.of("Info"), revision.info);
  if (revision.id) trailer.set(PDFName.of("ID"), revision.id);
  trailer.set(PDFName.of("Prev"), PDFNumber.of(revision.startxref));
  lines.push("trailer", trailer.toString(), "startxref", String(xrefAt), "%%EOF", "");
  parts.push(ascii(lines.join("\n")));

  const bytes = concat(...parts);
  const written = new Map(objects.map((o) => [o.ref.objectNumber, o]));
  return {
    bytes,
    bodyAt,
    revision: {
      ...revision,
      startxref: xrefAt,
      largestObjectNumber,
      resolve(ref) {
        const object = written.get(ref.objectNumber);
        if (!object) return revision.resolve(ref);
        if (object.ref.generationNumber !== ref.generationNumber) throw new Error(`no object ${ref.toString()}`);
        return PDFObjectParser.forBytes(object.body, revision.context).parseObject();
      },
    },
  };
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The first match of `pattern` (anchored with `^`) where `keyword` starts, reading a few hundred
 * bytes there: a search in the file's bytes, never a string of the whole file.
 */
export function matchAt(pdf: Uint8Array, keyword: string, pattern: RegExp, window = 256): RegExpExecArray | null {
  const buffer = bufferOf(pdf);
  for (let at = buffer.indexOf(keyword, 0, "latin1"); at >= 0; at = buffer.indexOf(keyword, at + 1, "latin1")) {
    const found = pattern.exec(latin1.decode(pdf.subarray(at, at + window)));
    if (found) return found;
  }
  return null;
}
