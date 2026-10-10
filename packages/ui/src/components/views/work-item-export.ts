import { listColumnKeys, type ListColumnKey, type ListColumnLayout, type Locale, type WorkItemRow } from "@rabaed/domain";
import type { ExportFormat } from "./list-menus.tsx";
import { placesOf } from "./work-item-board.tsx";
import { cellText, listDate, type WorkItemTableLabels, type WorkItemTableProps } from "./work-item-table.tsx";

// Export (RP-409, owner decision 2026-10-10): the List's rows as a file, either "what you see"
// (the columns the viewer shows, in their order) or "the whole table" (every List field), each
// cell as the List reads it, so only what the viewer may read. CSV, with a BOM so Excel reads
// Arabic; or an Excel workbook (SpreadsheetML, `.xml`, which Excel opens as a workbook with no
// warning and needs no library), dates as real dates, right to left in Arabic. A cell a
// spreadsheet would run as a formula is written as text, in both.

/** One cell: text, or a date (an ISO time) the file writes as a date. */
export type ExportCell = { text: string } | { date: string };
/** One column of the file: its header and each row's cell. */
export type ExportColumn = { header: string; cell: (row: WorkItemRow) => ExportCell };

export type ExportContext = {
  locale: Locale;
  labels: Pick<WorkItemTableLabels, "noNumber" | "revisionNoNumber" | "notPickedUp" | "cancelled" | "code" | "revision">;
  filters: WorkItemTableProps["filters"];
  headerOf: (key: ListColumnKey) => string;
  /** The file's and its sheet's name, without an extension, e.g. "Submittals". */
  name: string;
};

/** The whole table's own fields, beyond the List's columns, with their headers. */
export type WholeTableLabels = { typeName: string; location: string; creationDate: string; submissionDate: string; project: string };

/** A List column as an export column: the Created date as a date, every other cell as its text. */
function listColumn(key: ListColumnKey, context: ExportContext, places: ReturnType<typeof placesOf>): ExportColumn {
  return {
    header: context.headerOf(key),
    cell:
      key === "created"
        ? (row) => {
            const iso = row.creationDate ?? row.submissionDate;
            return iso === null ? { text: "" } : { date: iso };
          }
        : (row) => ({ text: cellText(key, row, context.locale, context.labels, context.filters, places) }),
  };
}

/** "What you see": the shown columns, in the viewer's order. */
export function shownColumns(columns: ListColumnLayout, context: ExportContext): ExportColumn[] {
  const places = placesOf(context.filters.locations);
  return columns.filter((c) => c.shown).map((c) => listColumn(c.key, context, places));
}

/**
 * "The whole table": every List column in its first order, shown or not, then the fields the
 * List keeps besides: the Type's name, the whole Location, the Creation Date (null to anyone but
 * the raiser's Participant, who alone reads it) and the Submission Date, and the Project.
 */
export function wholeTableColumns(context: ExportContext, labels: WholeTableLabels, projectName: string): ExportColumn[] {
  const places = placesOf(context.filters.locations);
  const date = (iso: string | null): ExportCell => (iso === null ? { text: "" } : { date: iso });
  return [
    ...listColumnKeys.map((key) => listColumn(key, context, places)),
    { header: labels.typeName, cell: (row) => ({ text: row.type.name[context.locale] }) },
    {
      header: labels.location,
      cell: (row) => ({
        text: row.location === null ? "" : (places.get(row.location.id) ?? [{ depth: 1, name: row.location.name }]).map((p) => p.name[context.locale]).join(" / "),
      }),
    },
    { header: labels.creationDate, cell: (row) => date(row.creationDate) },
    { header: labels.submissionDate, cell: (row) => date(row.submissionDate) },
    { header: labels.project, cell: () => ({ text: projectName }) },
  ];
}

export type ExportedFile = { name: string; type: string; content: string };

/** Tells Excel the CSV is UTF-8, so Arabic reads right. */
const byteOrderMark = String.fromCharCode(0xfeff);

/** A value a spreadsheet would run as a formula (=, +, -, @, a tab or a return first) is kept as text by a leading quote. */
export const asText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/**
 * `value` without the characters XML 1.0 may not hold (C0 controls but tab, line feed and
 * return; U+FFFE, U+FFFF; an unpaired surrogate), which would make Excel refuse the file.
 */
export const xmlCharacters = (value: string) =>
  Array.from(value)
    .filter((c) => {
      const code = c.codePointAt(0)!;
      if (code < 0x20) return code === 0x09 || code === 0x0a || code === 0x0d;
      return !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff;
    })
    .join("");

/** The calendar day of an ISO time in Riyadh (UTC+3 all year), as a spreadsheet date. */
const riyadhDay = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

export function exportFile(rows: WorkItemRow[], columns: ExportColumn[], format: ExportFormat, context: Pick<ExportContext, "locale" | "name">): ExportedFile {
  const cells = rows.map((row) => columns.map((c) => c.cell(row)));
  if (format === "csv") {
    const text = (cell: ExportCell) => asText("text" in cell ? cell.text : listDate(cell.date, context.locale));
    const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [columns.map((c) => asText(c.header)), ...cells.map((r) => r.map(text))];
    return { name: `${context.name}.csv`, type: "text/csv;charset=utf-8", content: `${byteOrderMark}${lines.map((r) => `${r.map(quoted).join(",")}\r\n`).join("")}` };
  }
  const xml = (value: string) =>
    xmlCharacters(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const textCell = (value: string, style = "") => `<Cell${style}><Data ss:Type="String">${xml(asText(value))}</Data></Cell>`;
  const cell = (c: ExportCell) =>
    "text" in c ? textCell(c.text) : `<Cell ss:StyleID="date"><Data ss:Type="DateTime">${riyadhDay(c.date)}T00:00:00.000</Data></Cell>`;
  const body = [
    `<Row>${columns.map((c) => textCell(c.header, ' ss:StyleID="head"')).join("")}</Row>`,
    ...cells.map((r) => `<Row>${r.map(cell).join("")}</Row>`),
  ].join("");
  // Sheet names hold at most 31 characters and none of : \ / ? * [ ].
  const sheet = xml(context.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  const options = context.locale === "ar" ? `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>` : "";
  return {
    name: `${context.name}.xml`,
    type: "application/xml",
    content:
      `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
      `<Styles><Style ss:ID="head"><Font ss:Bold="1"/></Style><Style ss:ID="date"><NumberFormat ss:Format="dd mmm yyyy"/></Style></Styles>` +
      `<Worksheet ss:Name="${sheet}"><Table>${body}</Table>${options}</Worksheet></Workbook>`,
  };
}

/** Hands the file to the browser to save. */
export function saveFile(file: ExportedFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
