import { parse as parseCsv } from "csv-parse/sync";
import readXlsxFile, { InvalidInputError } from "read-excel-file/universal";

// Reads an uploaded Submittal Register (RP-635, spec RP-631): an .xlsx workbook or a
// .csv file, on the server. It lists the sheets, then reads a chosen sheet from a
// chosen header row as text: every cell as written in the file, Arabic or English,
// never trimmed or translated. Nothing here knows about Submittals; the import maps
// the columns.
//
// Cells are read as stored, not as shown: the reader can't apply a cell's display
// format, and spec RP-631's owner chose this over a library that can (RP-631 comment
// 14098). Text cells are exactly as written. Other cells become text this way:
// - a number is the number stored in the file ("7", "1.5"), rounded to the 15 digits
//   Excel shows, so a cell shown as "1.50" reads "1.5", "15%" reads "0.15" and a
//   number formatted "0000" reads "12", not "0012"; a number typed as text stays as typed;
// - a date is its ISO date, "2026-03-15", with the time when it has one,
//   "2026-04-02 09:30", and a time of day alone is "09:30" ("03/04/2026" could be
//   either day first or month first);
// - TRUE and FALSE are "TRUE" and "FALSE"; an empty cell, or a formula that failed, is "".

const megabyte = 1024 * 1024;

export const spreadsheetLimits = {
  /** The largest file read: 10 MB. */
  maxBytes: 10 * megabyte,
  /** The most data rows a sheet may have below its header row, empty rows not counted. */
  maxDataRows: 2000,
  /** The most an .xlsx may unpack to: XML compresses well, so a small file could otherwise fill memory. */
  maxUnpackedBytes: 100 * megabyte,
} as const;

export type SpreadsheetRefusal =
  /** Not an .xlsx or a .csv (the old .xls included). */
  | "unsupported_type"
  /** An .xlsx or .csv that can't be read as one. */
  | "unreadable"
  /** A .csv that isn't UTF-8 (Excel's plain "CSV" on an Arabic Windows is Windows-1256: save as "CSV UTF-8"). */
  | "not_utf8"
  /** Over `maxBytes`: the documents' code for the same refusal. */
  | "file_too_large"
  | "unpacks_too_large"
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
  /** How many non-empty rows each sheet has, in the same order. */
  rowCounts: number[];
  /** The chosen sheet read from the chosen header row. */
  table(choice?: SheetChoice): SheetTable;
  /** A sheet's first `limit` rows from row 1, empty ones too (as ""), each as wide as its last non-empty cell. */
  top(sheet: string | undefined, limit: number): SheetRow[];
}

const unsupported = () => new SpreadsheetError("unsupported_type", "Only .xlsx and .csv files can be read.");

/** Reads the whole file once; `table` then reads any sheet of it from any header row. */
export async function openSpreadsheet(file: SpreadsheetFile): Promise<Spreadsheet> {
  const { bytes } = file;
  const { maxBytes } = spreadsheetLimits;
  if (bytes.length > maxBytes) {
    throw new SpreadsheetError("file_too_large", `The file is over ${maxBytes / megabyte} MB.`, { bytes: bytes.length, maxBytes });
  }
  const extension = /\.([^.]+)$/.exec(file.fileName)?.[1]?.toLowerCase();
  const sheets = extension === "xlsx" ? await readXlsx(bytes) : extension === "csv" ? [readCsv(file.fileName, bytes)] : null;
  if (!sheets) throw unsupported();
  const sheetNamed = (name: string | undefined) => {
    const sheet = name === undefined ? sheets[0] : sheets.find((each) => each.name === name);
    if (!sheet) throw new SpreadsheetError("sheet_not_found", "The workbook has no sheet of that name.");
    return sheet;
  };
  return {
    sheets: sheets.map((sheet) => sheet.name),
    rowCounts: sheets.map((sheet) => sheet.rows.filter((row) => row.some((cell) => cell !== "")).length),
    table: (choice = {}) => tableOf(sheetNamed(choice.sheet), choice.headerRow ?? 1),
    top: (name, limit) =>
      sheetNamed(name)
        .rows.slice(0, limit)
        .map((values, index) => ({ rowNo: index + 1, values: values.slice(0, values.findLastIndex((cell) => cell !== "") + 1) })),
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
  const { maxDataRows } = spreadsheetLimits;
  if (data.length > maxDataRows) {
    throw new SpreadsheetError("too_many_rows", `The sheet has over ${maxDataRows} data rows.`, { rows: data.length, maxDataRows });
  }
  // As wide as its widest non-empty cell, from the header row down; every row filled out to that width.
  const widthOf = (row: string[]) => row.findLastIndex((cell) => cell !== "") + 1;
  const width = Math.max(widthOf(header), ...data.map((row) => widthOf(row.values)));
  const padded = (row: string[]) => Array.from({ length: width }, (_, column) => row[column] ?? "");
  return { sheet: sheet.name, headerRow, headers: padded(header), rows: data.map((row) => ({ rowNo: row.rowNo, values: padded(row.values) })) };
}

async function readXlsx(bytes: Uint8Array): Promise<TextSheet[]> {
  const unpacked = unpackedSize(bytes);
  if (unpacked === null) throw new SpreadsheetError("unreadable", "The file isn't an .xlsx workbook that can be read.");
  const { maxUnpackedBytes } = spreadsheetLimits;
  if (unpacked > maxUnpackedBytes) {
    throw new SpreadsheetError("unpacks_too_large", `The workbook unpacks to over ${maxUnpackedBytes / megabyte} MB.`, { maxUnpackedBytes });
  }
  let sheets;
  try {
    // The universal build unzips with fflate, which inflates each part into a buffer of the size
    // the central directory states: the sizes summed above are the most it can inflate, whatever
    // the parts hold (a part that inflates further is cut short, and fails to parse). The Node
    // build streams the parts by their local headers instead, which this check doesn't read.
    // Numbers come back as the text stored in the file, so "0.1" never turns into 0.1000000001.
    // A copy that is exactly the file: a Buffer is often a view into a larger pool, and Buffer#slice doesn't copy.
    const file = new Uint8Array(bytes).buffer;
    sheets = await readXlsxFile<StoredNumber>(file, { trim: false, parseNumber: (stored) => ({ stored }) });
  } catch (error) {
    if (error instanceof InvalidInputError && error.code === "XLS_FILE_NOT_SUPPORTED") throw unsupported();
    throw new SpreadsheetError("unreadable", "The file isn't an .xlsx workbook that can be read.");
  }
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data.map((row) => row.map(cellText)) }));
}

/** A number cell's value as the file stores it, apart from text that only looks like a number. */
interface StoredNumber {
  stored: string;
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "object" && "stored" in cell) return numberText((cell as StoredNumber).stored);
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (cell instanceof Date) return dateText(cell);
  return String(cell);
}

/**
 * A number as stored, to the 15 significant digits Excel keeps and shows: what it stores
 * for =0.1+0.2 is 0.30000000000000004, which it shows as 0.3.
 */
function numberText(stored: string): string {
  const digits = stored.replace(/e.*$/i, "").replace(/[-.]/g, "").replace(/^0+/, "");
  if (digits.length <= 15) return stored;
  return String(Number(Number(stored).toPrecision(15)));
}

/** A date cell as ISO text. Excel stores the clock time as written, which the reader returns as UTC. */
function dateText(date: Date): string {
  // A serial date's fraction of a day rounds to the nearest second (09:30 can be stored as 09:29:59.9999).
  const iso = new Date(Math.round(date.getTime() / 1000) * 1000).toISOString();
  const [day, time] = [iso.slice(0, 10), iso.slice(11, 19)];
  const clock = time.endsWith(":00") ? time.slice(0, 5) : time;
  // A time of day alone is a serial date under 1, which falls on Excel's day 0, in 1899.
  if (day.startsWith("1899-")) return clock;
  return time === "00:00:00" ? day : `${day} ${clock}`;
}

/**
 * What an .xlsx (a zip) says it unpacks to, from the central directory, as fflate reads it:
 * null when it isn't a zip, or is a ZIP64 one (Excel writes ZIP64 only past 4 GB).
 */
function unpackedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of up to 65,535 bytes.
  // fflate takes the first one found walking back from the end, so this does too.
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (entries === 0xffff || offset === 0xffffffff) return null;
  let total = 0;
  for (let entry = 0; entry < entries; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) return null;
    total += size;
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
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
  // Comma, or semicolon as Excel writes in locales where the comma is the decimal mark:
  // whichever splits more rows into the same number of cells; a tie is a comma.
  const readings = [",", ";"].map((delimiter) => csvRows(text, delimiter)).filter((rows) => rows !== null);
  if (readings.length === 0) throw new SpreadsheetError("unreadable", "The .csv file can't be read.");
  const rows = readings.reduce((best, rows) => (consistency(rows) > consistency(best) ? rows : best));
  return { name, rows };
}

function csvRows(text: string, delimiter: string): string[][] | null {
  try {
    // relax_quotes keeps a quote inside an unquoted value, such as an inch mark (Pipe 2" dia).
    return parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false }) as string[][];
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
