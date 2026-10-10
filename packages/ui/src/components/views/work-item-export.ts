import type { ListColumnKey, ListColumnLayout, Locale, WorkItemRow } from "@rabaed/domain";
import type { ExportFormat } from "./list-menus.tsx";
import { cellText, type WorkItemTableLabels, type WorkItemTableProps } from "./work-item-table.tsx";
import { placesOf } from "./work-item-board.tsx";

// Export (RP-409): the List's rows as a file, the columns the viewer shows, in their order, each
// cell as the table shows it (so as the viewer may read it). CSV, with a BOM so Excel reads Arabic;
// or Excel, as a SpreadsheetML workbook (.xls) of text cells, which needs no library.

export type ExportContext = {
  locale: Locale;
  labels: Pick<WorkItemTableLabels, "noNumber" | "revisionNoNumber" | "unclaimed" | "cancelled" | "code" | "revision">;
  filters: WorkItemTableProps["filters"];
  headerOf: (key: ListColumnKey) => string;
  /** The file's name, without its extension, e.g. "submittals". */
  name: string;
};

export type ExportedFile = { name: string; type: string; content: string };

/** Tells Excel the CSV is UTF-8, so Arabic reads right. */
const byteOrderMark = String.fromCharCode(0xfeff);

export function exportFile(rows: WorkItemRow[], columns: ListColumnLayout, format: ExportFormat, context: ExportContext): ExportedFile {
  const keys = columns.filter((c) => c.shown).map((c) => c.key);
  const places = placesOf(context.filters.locations);
  const table = [
    keys.map((key) => context.headerOf(key)),
    ...rows.map((row) => keys.map((key) => cellText(key, row, context.locale, context.labels, context.filters, places))),
  ];
  if (format === "csv") {
    const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
    return { name: `${context.name}.csv`, type: "text/csv;charset=utf-8", content: `${byteOrderMark}${table.map((r) => `${r.map(quoted).join(",")}\r\n`).join("")}` };
  }
  const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const body = table.map((r) => `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${xml(c)}</Data></Cell>`).join("")}</Row>`).join("");
  return {
    name: `${context.name}.xls`,
    type: "application/vnd.ms-excel",
    content: `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${xml(context.name)}"><Table>${body}</Table></Worksheet></Workbook>`,
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
