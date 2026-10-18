import { isOpenStageCategory, type Locale, type WorkItemList as WorkItemListData, type WorkItemRow } from "@rabaed/domain";
import { ownerOf, placesOf } from "./work-item-board.tsx";
import { exportFile, type ExportColumn, type ExportedFile } from "./work-item-export.ts";

// The Snag List's Excel export (RP-629, spec RP-619): the rows the viewer reads, one line per item, as
// the List shows them: Document Number, Subject, Type, Trade, Location, Stage, what it was raised from,
// who it is with (V14) and its Step Age in weeks. Never a due date or "overdue": Step Age only. The
// rows come from the API's own read, so a file holds only what the viewer sees (V3).

/** The export's words, from the app's messages. */
export type SnagExportLabels = {
  documentNumber: string;
  subject: string;
  type: string;
  trade: string;
  location: string;
  stage: string;
  raisedFrom: string;
  with: string;
  /** The Step Age column, in weeks: "Step Age (weeks)". */
  stepAgeWeeks: string;
  /** The "Raised from" of an item raised by hand. */
  raisedManually: string;
  /** After a Step's name, when nobody in the viewer's Company has picked it up. */
  notPickedUp: string;
  noNumber: string;
  /** The file's name, without an extension, e.g. "Snag List". */
  fileName: string;
};

/** The columns of the file for the rows the viewer reads. */
export function snagExportColumns(locale: Locale, labels: SnagExportLabels, locations: WorkItemListData["filters"]["locations"]): ExportColumn[] {
  const places = placesOf(locations);
  const text = (value: string) => ({ text: value });
  return [
    { header: labels.documentNumber, cell: (r: WorkItemRow) => text(r.documentNumber ?? labels.noNumber) },
    { header: labels.subject, cell: (r) => text(r.title) },
    { header: labels.type, cell: (r) => text(r.type.name[locale]) },
    { header: labels.trade, cell: (r) => text(r.trade.name[locale]) },
    {
      header: labels.location,
      cell: (r) =>
        text(r.location === null ? "" : (places.get(r.location.id) ?? [{ depth: 1, name: r.location.name }]).map((p) => p.name[locale]).join(" / ")),
    },
    { header: labels.stage, cell: (r) => text(r.stage.name[locale]) },
    {
      header: labels.raisedFrom,
      cell: (r) => text(r.raisedFrom === undefined ? "" : r.raisedFrom === null ? labels.raisedManually : r.raisedFrom.documentNumber),
    },
    { header: labels.with, cell: (r) => text(ownerOf(r, locale, labels)?.name ?? "") },
    { header: labels.stepAgeWeeks, cell: (r) => text(isOpenStageCategory(r.stage.category) && r.stepAgeWeeks !== null ? String(r.stepAgeWeeks) : "") },
  ];
}

/** The rows as an Excel workbook (SpreadsheetML, as the List's Export writes it). */
export function snagExcel(rows: WorkItemRow[], locale: Locale, labels: SnagExportLabels, locations: WorkItemListData["filters"]["locations"]): ExportedFile {
  return exportFile(rows, snagExportColumns(locale, labels, locations), "excel", { locale, name: labels.fileName });
}
