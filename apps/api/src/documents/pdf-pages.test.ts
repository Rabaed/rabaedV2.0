import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { countPdfPages } from "./pdf-pages.ts";

/** Objects 1…n as a PDF with a classic cross-reference table; `extra` is appended as an incremental update. */
function classicPdf(objects: readonly string[], extra = ""): Buffer {
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body + extra, "latin1");
}

const pages = (n: number, first = 3) => Array.from({ length: n }, (_, i) => `${i + first} 0 R`).join(" ");
const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>";

/** A PDF 1.5 whose Catalog and page tree are inside a Flate-compressed object stream, with an xref stream, as Word and most CAD tools write them. */
function objectStreamPdf(n: number): Buffer {
  const inStream = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages(n)}] /Count ${n} >>`, ...Array.from({ length: n }, () => page)];
  let header = "";
  let data = "";
  inStream.forEach((object, i) => {
    header += `${i + 1} ${data.length} `;
    data += `${object}\n`;
  });
  const packed = deflateSync(Buffer.from(header + data, "latin1"));
  const objStmNo = inStream.length + 1;
  let body = "%PDF-1.5\n";
  const objStmAt = Buffer.byteLength(body, "latin1");
  body += `${objStmNo} 0 obj\n<< /Type /ObjStm /N ${inStream.length} /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`;
  const head = Buffer.from(body, "latin1");
  const tail = Buffer.from("\nendstream\nendobj\n", "latin1");
  const xrefAt = head.length + packed.length + tail.length;
  // The xref stream: type 2 (in an object stream) for each packed object, type 1 for the streams themselves.
  const rows: number[][] = [[0, 0, 0]];
  inStream.forEach((_, i) => rows.push([2, objStmNo, i]));
  rows.push([1, objStmAt, 0]);
  rows.push([1, xrefAt, 0]);
  const xrefData = deflateSync(Buffer.from(rows.flatMap(([t, a, b]) => [t!, (a! >> 24) & 255, (a! >> 16) & 255, (a! >> 8) & 255, a! & 255, b!])));
  const xrefNo = objStmNo + 1;
  const xrefHead = Buffer.from(
    `${xrefNo} 0 obj\n<< /Type /XRef /Size ${xrefNo + 1} /W [1 4 1] /Root 1 0 R /Filter /FlateDecode /Length ${xrefData.length} >>\nstream\n`,
    "latin1",
  );
  const end = Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`, "latin1");
  return Buffer.concat([head, packed, tail, xrefHead, xrefData, end]);
}

describe("a PDF's page count (RP-1189)", () => {
  it("counts the pages of a PDF with a classic cross-reference table", async () => {
    const pdf = (n: number) => classicPdf(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages(n)}] /Count ${n} >>`, ...Array.from({ length: n }, () => page)]);
    expect(await countPdfPages(pdf(1))).toBe(1);
    expect(await countPdfPages(pdf(12))).toBe(12);
  });

  it("counts the pages of a nested page tree from its root, not a branch", async () => {
    const nested = classicPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 5 >>",
      "<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 >>",
      "<< /Type /Pages /Parent 2 0 R /Kids [7 0 R 8 0 R 9 0 R] /Count 3 >>",
      ...Array.from({ length: 5 }, () => page),
    ]);
    expect(await countPdfPages(nested)).toBe(5);
  });

  it("counts the pages of a PDF whose page tree is in a compressed object stream", async () => {
    expect(await countPdfPages(objectStreamPdf(4))).toBe(4);
  });

  it("gives none for bytes that aren't a PDF it can read", async () => {
    expect(await countPdfPages(Buffer.from("%PDF-1.7 not really a PDF"))).toBeNull();
    expect(await countPdfPages(Buffer.from("plain text"))).toBeNull();
    expect(await countPdfPages(new Uint8Array())).toBeNull();
  });
});
