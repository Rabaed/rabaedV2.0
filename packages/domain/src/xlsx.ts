/* eslint-disable rabaed/no-avoid-terms -- "Relationships" are the Office Open XML format's own part names, not copy */
/**
 * A small .xlsx writer (RP-644): worksheets of text cells, each one's first row bold, left-to-right
 * or right-to-left. The Submittal Register Import's downloads (the rejected rows with a reasons
 * column, the log, and RP-954's template and sample register) are built with it in the browser,
 * in the reader's language.
 *
 * It writes no document properties (no docProps/core.xml: no author, no created or modified
 * time) and dates every zip entry 1980-01-01, the format's earliest: a workbook made from an
 * import never tells when the import ran (owner, 2026-10-19). Entries are stored, not
 * compressed, so it needs no library and runs anywhere.
 */

export type XlsxSheet = {
  /** The worksheet's name (at most 31 characters, as Excel allows). */
  name: string;
  /** Each row's cells, as text. The first row is the column headings, shown bold. */
  rows: readonly (readonly string[])[];
  rightToLeft?: boolean;
  /**
   * The first this many columns set to text (RP-954, the register template): what is typed in them
   * is stored as typed, so a reference number 0012 keeps its zeros. The headings still read bold.
   */
  textColumns?: number;
};

/** The media type of an .xlsx file. */
export const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00 in the zip format's DOS date and time: no real time in the file. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: the entry names are UTF-8. */
const UTF8_NAMES = 0x0800;

/** A zip of `files`, each stored as is, dated 1980-01-01. */
function zip(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, UTF8_NAMES, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, DOS_TIME, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, file.bytes.length, true);
    l.setUint32(22, file.bytes.length, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8_NAMES, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, file.bytes.length, true);
    c.setUint32(24, file.bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, file.bytes);
    centrals.push(central);
    offset += local.length + file.bytes.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Whether XML 1.0 can hold the character: not a control character other than tab, line feed and carriage return, nor U+FFFE or U+FFFF. */
const xmlChar = (c: string) => {
  const code = c.charCodeAt(0);
  return (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) && code !== 0xfffe && code !== 0xffff;
};

/** Text as XML character data: escaped, without the characters XML can't hold. */
function xmlText(text: string): string {
  return [...text]
    .filter(xmlChar)
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A worksheet name Excel accepts: none of : \ / ? * [ ], 1–31 characters. */
function sheetName(name: string): string {
  const clean = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return clean === "" ? "Sheet1" : clean;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** A worksheet's XML: its rows, the first frozen at the top, and its text columns. */
function worksheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows
    .map((cells, r) => {
      const style = r === 0 ? 1 : 2;
      const xml = cells
        .map((text, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`)
        .join("");
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join("");
  // Style 2 is text (number format 49): a cell typed in such a column is kept as typed.
  const cols = sheet.textColumns ? `<cols><col min="1" max="${sheet.textColumns}" width="24" style="2" customWidth="1"/></cols>` : "";
  return (
    `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">` +
    `<sheetViews><sheetView workbookViewId="0"${sheet.rightToLeft ? ' rightToLeft="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** The .xlsx of `sheets`, in order: the first is the one a reader opens on. */
export function writeXlsx(...sheets: [XlsxSheet, ...XlsxSheet[]]): Uint8Array {
  const encoder = new TextEncoder();
  const numbered = sheets.map((sheet, i) => ({ sheet, n: i + 1 }));
  const files = [
    {
      name: "[Content_Types].xml",
      xml:
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        numbered.map(({ n }) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml: `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets>${numbered.map(({ sheet, n }) => `<sheet name="${xmlText(sheetName(sheet.name))}" sheetId="${n}" r:id="rId${n}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml:
        `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
        numbered.map(({ n }) => `<Relationship Id="rId${n}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/styles.xml",
      xml:
        `${XML}<styleSheet xmlns="${MAIN}">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>` +
        `</styleSheet>`,
    },
    ...numbered.map(({ sheet, n }) => ({ name: `xl/worksheets/sheet${n}.xml`, xml: worksheetXml(sheet) })),
  ];
  return zip(files.map((f) => ({ name: f.name, bytes: encoder.encode(f.xml) })));
}
