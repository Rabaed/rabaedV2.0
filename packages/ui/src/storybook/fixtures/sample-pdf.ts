/**
 * A small PDF for the Attachments stories (RP-1068), built here so no binary fixture is committed:
 * A4 pages drawn from vector shapes only, no text (a font's glyphs would differ between machines
 * and change the screenshots). Page n carries n squares in its top corner, so a test can tell the
 * pages apart.
 */
export function samplePdf(pages: number): Uint8Array {
  const objects: string[] = [];
  // 1: the catalogue, 2: the page tree, then a page and its content stream per page.
  const pageIds = Array.from({ length: pages }, (_, i) => 3 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`);
  for (let page = 1; page <= pages; page++) {
    const content = sheet(page);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageIds[page - 1]! + 1} 0 R /Resources << >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // ASCII only, so a character is a byte and the offsets above hold.
  return new TextEncoder().encode(pdf);
}

/** One sheet: a title block, grey "text" bars, a picture box, a table, and the page's own marks. */
function sheet(page: number): string {
  const fill = (grey: number, x: number, y: number, w: number, h: number) => `${grey} g ${x} ${y} ${w} ${h} re f`;
  const lines = [
    // The title block, in a deep blue.
    "0.11 0.2 0.36 rg 48 760 499 40 re f",
    fill(0.75, 48, 720, 380, 12),
    fill(0.85, 48, 700, 460, 10),
    fill(0.85, 48, 684, 420, 10),
    fill(0.85, 48, 668, 440, 10),
    // The picture box.
    "0.93 0.95 0.98 rg 48 430 499 210 re f",
    "0.65 0.72 0.85 rg 220 480 150 110 re f",
    // A table: a header and four rows.
    fill(0.8, 48, 380, 499, 18),
    ...[0, 1, 2, 3].map((row) => fill(row % 2 ? 0.94 : 0.9, 48, 356 - row * 24, 499, 20)),
    fill(0.85, 48, 220, 400, 10),
    fill(0.85, 48, 204, 300, 10),
    // The page's own marks: n orange squares.
    ...Array.from({ length: page }, (_, i) => `0.93 0.35 0.2 rg ${515 - i * 22} 770 16 16 re f`),
  ];
  return lines.join("\n");
}

/** A same-origin URL the story's `fileUrl` hands out, as the api hands out a signed URL. */
export function samplePdfUrl(pages: number): string {
  return URL.createObjectURL(new Blob([samplePdf(pages) as BlobPart], { type: "application/pdf" }));
}
