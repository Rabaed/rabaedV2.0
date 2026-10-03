// A one-page PDF of a few lines of text, for the demo seed's datasheets: a real
// PDF a browser opens, built by hand so the repo holds no document files. Latin
// text only (the standard Helvetica font, no embedded fonts).

/** `lines` as a one-page A4 PDF, a title first, then the rest smaller. */
export function demoPdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines
    .map((line, i) => (i === 0 ? `/F1 16 Tf (${escape(line)}) Tj 0 -28 Td /F1 11 Tf` : `(${escape(line)}) Tj 0 -16 Td`))
    .join(" ");
  const content = `BT 56 780 Td ${text} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
