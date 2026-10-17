import { parse as parseCsv } from "csv-parse/sync";
import readXlsxFile, { InvalidInputError } from "read-excel-file/node";

// Reads an uploaded Submittal Register (RP-635, spec RP-631): an .xlsx workbook or a
// .csv file, on the server. It lists the sheets, then reads a chosen sheet from a
// chosen header row as text: every cell as written in the file, Arabic or English,
// never trimmed or translated. Nothing here knows about Submittals; the import maps
// the columns.
//
// Cells that aren't text become text this way:
// - a number is the number stored in the file ("7", "1.5"), without its display
//   format (a cell shown as "1.50" reads "1.5"); a number typed as text ("0012") stays as typed;
// - a date is its ISO date, "2026-03-15", with the time when it has one,
//   "2026-04-02 09:30" (the reader can't apply the cell's display format, and
//   "03/04/2026" could be either day first or month first);
// - TRUE and FALSE are "TRUE" and "FALSE"; an empty cell, or a formula that failed, is "".

export const spreadsheetLimits = {
  /** The largest file read: 10 MB. */
  maxBytes: 10 * 1024 * 1024,
  /** The most data rows a sheet may have below its header row, empty rows not counted. */
  maxDataRows: 2000,
  /** The most an .xlsx may unpack to: a few MB of XML compresses far smaller, so a small file can still fill memory. */
  maxUnpackedBytes: 100 * 1024 * 1024,
} as const;

export type SpreadsheetRefusal =
  /** Not an .xlsx or a .csv (the old .xls included). */
  | "unsupported_type"
  /** An .xlsx or .csv that can't be read as one. */
  | "unreadable"
  /** A .csv that isn't UTF-8 (Excel's plain "CSV" on an Arabic Windows is Windows-1256: save as "CSV UTF-8"). */
  | "not_utf8"
  | "too_large"
  | "too_large_unpacked"
  | "too_many_rows"
  | "sheet_not_found"
  | "header_row_not_found"
  | "empty_header_row";

/** Why a file or a choice in it can't be read. The message names no value from the file. */
export class SpreadsheetError extends Error {
  constructor(
    readonly reason: SpreadsheetRefusal,
    message: string,
    readonly details?: Record<string, number>,
  ) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

export interface SpreadsheetFile {
  /** The uploaded file's name: its extension says how to read it. */
  fileName: string;
  bytes: Uint8Array;
}

export interface SheetChoice {
  /** The sheet's name; the first sheet when left out. */
  sheet?: string;
  /** The header row's number in the sheet, from 1; row 1 when left out. */
  headerRow?: number;
}

export interface SheetRow {
  /** The row's number in the sheet, as the spreadsheet shows it. */
  rowNo: number;
  /** One value per header, "" for an empty cell. */
  values: string[];
}

export interface SheetTable {
  sheet: string;
  headerRow: number;
  /** As written; "" under a merged or empty header cell. */
  headers: string[];
  /** The non-empty rows below the header row, in order. */
  rows: SheetRow[];
}

export interface Spreadsheet {
  /** The sheet names, in the workbook's order; a .csv has one, named after the file. */
  sheets: string[];
  /** The chosen sheet read from the chosen header row. */
  table(choice?: SheetChoice): SheetTable;
}

/** Reads the whole file once; `table` then reads any sheet of it from any header row. */
export async function openSpreadsheet(file: SpreadsheetFile): Promise<Spreadsheet> {
  const { bytes } = file;
  if (bytes.length > spreadsheetLimits.maxBytes) {
    throw new SpreadsheetError("too_large", "The file is over 10 MB.", { bytes: bytes.length, maxBytes: spreadsheetLimits.maxBytes });
  }
  const extension = /\.([^.]+)$/.exec(file.fileName)?.[1]?.toLowerCase();
  const sheets = extension === "xlsx" ? await readXlsx(bytes) : extension === "csv" ? [readCsv(file.fileName, bytes)] : null;
  if (!sheets) throw new SpreadsheetError("unsupported_type", "Only .xlsx and .csv files can be read.");
  return {
    sheets: sheets.map((sheet) => sheet.name),
    table: (choice = {}) => {
      const sheet = choice.sheet === undefined ? sheets[0] : sheets.find((each) => each.name === choice.sheet);
      if (!sheet) throw new SpreadsheetError("sheet_not_found", "The workbook has no sheet of that name.");
      return tableOf(sheet, choice.headerRow ?? 1);
    },
  };
}

/** A sheet as text: its rows from row 1, each cell as text. */
interface TextSheet {
  name: string;
  rows: string[][];
}

function tableOf(sheet: TextSheet, headerRow: number): SheetTable {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > sheet.rows.length) {
    throw new SpreadsheetError("header_row_not_found", "The sheet has no such row.", { headerRow, rows: sheet.rows.length });
  }
  const isEmpty = (row: string[]) => row.every((cell) => cell === "");
  const header = sheet.rows[headerRow - 1]!;
  if (isEmpty(header)) throw new SpreadsheetError("empty_header_row", "The header row is empty.", { headerRow });
  const data = sheet.rows
    .map((values, index) => ({ rowNo: index + 1, values }))
    .filter((row) => row.rowNo > headerRow && !isEmpty(row.values));
  if (data.length > spreadsheetLimits.maxDataRows) {
    throw new SpreadsheetError("too_many_rows", "The sheet has over 2,000 data rows.", { rows: data.length, maxDataRows: spreadsheetLimits.maxDataRows });
  }
  // As wide as its widest non-empty cell, from the header row down; every row filled out to that width.
  const lastCell = (row: string[]) => row.findLastIndex((cell) => cell !== "") + 1;
  const width = Math.max(lastCell(header), ...data.map((row) => lastCell(row.values)));
  const fit = (row: string[]) => Array.from({ length: width }, (_, column) => row[column] ?? "");
  return { sheet: sheet.name, headerRow, headers: fit(header), rows: data.map((row) => ({ rowNo: row.rowNo, values: fit(row.values) })) };
}

async function readXlsx(bytes: Uint8Array): Promise<TextSheet[]> {
  const unpacked = unpackedSize(bytes);
  if (unpacked === null) throw new SpreadsheetError("unreadable", "The file isn't an .xlsx workbook.");
  if (unpacked > spreadsheetLimits.maxUnpackedBytes) {
    throw new SpreadsheetError("too_large_unpacked", "The workbook unpacks to over 100 MB.", { maxUnpackedBytes: spreadsheetLimits.maxUnpackedBytes });
  }
  let sheets;
  try {
    // Numbers come back as the text stored in the file, so "0.1" never turns into 0.1000000001.
    sheets = await readXlsxFile(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { trim: false, parseNumber: (text) => text });
  } catch (error) {
    if (error instanceof InvalidInputError && error.code === "XLS_FILE_NOT_SUPPORTED") {
      throw new SpreadsheetError("unsupported_type", "Only .xlsx and .csv files can be read.");
    }
    throw new SpreadsheetError("unreadable", "The file isn't an .xlsx workbook that can be read.");
  }
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data.map((row) => row.map(cellText)) }));
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (cell instanceof Date) return dateText(cell);
  return String(cell);
}

/** A date cell as ISO text. Excel stores the clock time as written, which the reader returns as UTC. */
function dateText(date: Date): string {
  // A serial date's fraction of a day rounds to the nearest second (09:30 can be stored as 09:29:59.9999).
  const iso = new Date(Math.round(date.getTime() / 1000) * 1000).toISOString();
  const [day, time] = [iso.slice(0, 10), iso.slice(11, 19)];
  if (time === "00:00:00") return day;
  return `${day} ${time.endsWith(":00") ? time.slice(0, 5) : time}`;
}

/**
 * What an .xlsx (a zip) says it unpacks to, from its central directory: null when it
 * isn't a zip, Infinity for a size the zip can't state in 32 bits (ZIP64).
 */
function unpackedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of up to 65,535 bytes.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (entries === 0xffff || at === 0xffffffff) return Infinity;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const size = view.getUint32(at + 24, true);
    if (size === 0xffffffff) return Infinity;
    total += size;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return total;
}

function readCsv(fileName: string, bytes: Uint8Array): TextSheet {
  let text: string;
  try {
    // A UTF-8 BOM, when there is one, is dropped here.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SpreadsheetError("not_utf8", "The .csv file isn't UTF-8.");
  }
  const name = fileName.replace(/\.[^.]+$/, "");
  // Comma, or semicolon as Excel writes in locales where the comma is the decimal mark: whichever splits more rows alike.
  const readings = [",", ";"].map((delimiter) => csvRows(text, delimiter)).filter((rows) => rows !== null);
  if (readings.length === 0) throw new SpreadsheetError("unreadable", "The .csv file can't be read.");
  const rows = readings.reduce((best, rows) => (consistency(rows) > consistency(best) ? rows : best));
  return { name, rows };
}

function csvRows(text: string, delimiter: string): string[][] | null {
  try {
    return parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: false }) as string[][];
  } catch {
    return null;
  }
}

/** How many rows split into the most common number of cells, over one cell. */
function consistency(rows: string[][]): number {
  const counts = new Map<number, number>();
  for (const row of rows) if (row.length > 1) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}
