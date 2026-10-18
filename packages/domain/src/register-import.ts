import { z } from "zod";
import { bilingualText } from "./company.ts";
import { workItemTypeCode } from "./work-item.ts";

/**
 * The Submittal Register Import (RP-637, spec RP-631): a Member uploads their
 * Company's register (.xlsx or .csv), picks the sheet and its header row, maps the
 * columns to Subject, Type and Trade, previews every row with every reason a bad one
 * is bad, and confirms: a Draft for every good row, none for the bad. Only Members of
 * the importing Participant read an import (visibility.md RP-589-1).
 */

/** The largest register read (the api's spreadsheet reader refuses a larger one): 10 MB. */
export const registerImportMaxBytes = 10 * 1024 * 1024;

/** An uploaded register: its name (whose extension says how to read it) and its bytes, base64. */
export const registerImportFile = z.object({
  fileName: z.string().trim().min(1).max(255),
  // 10 MB as base64, with room for the padding.
  content: z.base64().max(Math.ceil(registerImportMaxBytes / 3) * 4 + 4),
});
export type RegisterImportFile = z.infer<typeof registerImportFile>;

/** Read a register: its sheets, and one sheet from one header row (the first sheet, row 1, when left out). */
export const readRegisterRequest = z.object({
  file: registerImportFile,
  sheet: z.string().optional(),
  headerRow: z.int().min(1).optional(),
});
export type ReadRegisterRequest = z.infer<typeof readRegisterRequest>;

/** A row of a sheet as read: its number in the sheet, and every cell as text, as stored in the file. */
export const registerSheetRow = z.object({ rowNo: z.int().min(1), cells: z.array(z.string()) });
export type RegisterSheetRow = z.infer<typeof registerSheetRow>;

/** How many top rows of a sheet the header-row step shows. */
export const registerTopRows = 12;

/** A register as read, for the sheet and header-row step and the mapping step. */
export const registerSheet = z.object({
  /** Every sheet, with how many non-empty rows it has (a .csv has one, named after the file). */
  sheets: z.array(z.object({ name: z.string(), rows: z.int().min(0) })),
  sheet: z.string(),
  headerRow: z.int().min(1),
  /** The sheet's first rows, empty ones too, to pick the header row from. */
  top: z.array(registerSheetRow),
  /** The header row's cells: the columns to map. */
  headers: z.array(z.string()),
  /** The first data row's cell under each header ("" when none): the mapping step's examples. */
  examples: z.array(z.string()),
  /** How many non-empty rows lie below the header row. */
  dataRows: z.int().min(0),
});
export type RegisterSheet = z.infer<typeof registerSheet>;

/** A column of the header row, from 0. */
const column = z.object({ column: z.int().min(0) });

/**
 * Which column gives each field: the Subject from a column, the Type and the Trade
 * each from a column or one value for every row (a Type code; a Trade's id).
 * Columns not mapped are ignored.
 */
export const registerImportMapping = z.object({
  subject: column,
  type: z.union([column, z.object({ value: workItemTypeCode })]),
  trade: z.union([column, z.object({ value: z.uuid() })]),
});
export type RegisterImportMapping = z.infer<typeof registerImportMapping>;

/** Preview a register: read the sheet from the header row, apply the mapping and check every row. Nothing is created. */
export const previewRegisterImportRequest = z.object({
  file: registerImportFile,
  sheet: z.string(),
  headerRow: z.int().min(1),
  mapping: registerImportMapping,
});
export type PreviewRegisterImportRequest = z.infer<typeof previewRegisterImportRequest>;

/**
 * Every reason a row is bad, in this order. A row has all of its reasons, not only
 * the first. The database checks the same list (submittal_register_import_row).
 */
export const registerImportRowReasons = [
  "subject_missing",
  "subject_too_long",
  "type_missing",
  "type_unknown",
  "type_not_allowed",
  "trade_missing",
  "trade_unknown",
  "trade_outside_visibility",
] as const;
export const registerImportRowReason = z.enum(registerImportRowReasons);
export type RegisterImportRowReason = z.infer<typeof registerImportRowReason>;

/** One row of an import: as read, what it matched, why it is bad, and the Draft it created. */
export const registerImportRow = z.object({
  rowNo: z.int().min(1),
  /** Every cell of the row, one per header, as read. */
  cells: z.array(z.string()),
  /** The mapped values as read ("" for an empty cell); a fixed Type or Trade as its code. */
  subject: z.string(),
  type: z.object({ text: z.string(), match: z.object({ code: workItemTypeCode, name: bilingualText }).nullable() }),
  trade: z.object({ text: z.string(), match: z.object({ id: z.uuid(), code: z.string(), name: bilingualText }).nullable() }),
  /** Empty for a good row. */
  reasons: z.array(registerImportRowReason),
  /** Whether confirm created a Draft from it. */
  created: z.boolean(),
  /** That Draft, only when the caller sees it (not after it was Deleted, nor outside their Visibility). */
  workItemId: z.uuid().nullable(),
});
export type RegisterImportRow = z.infer<typeof registerImportRow>;

/** An import, as the Imports page lists it. No time: when it was confirmed is when its Drafts were started (scenario 61). */
export const registerImportSummary = z.object({
  id: z.uuid(),
  fileName: z.string(),
  status: z.enum(["previewed", "created"]),
  /** Who imported it: a Member of the caller's own Company. */
  runBy: z.object({ id: z.uuid(), name: bilingualText }),
  rowsTotal: z.int().min(0),
  rowsRejected: z.int().min(0),
  /** Null until confirmed. */
  rowsCreated: z.int().min(0).nullable(),
});
export type RegisterImportSummary = z.infer<typeof registerImportSummary>;

export const registerImports = z.object({ imports: z.array(registerImportSummary) });
export type RegisterImports = z.infer<typeof registerImports>;

/** One import with its rows: the preview before confirm, the record after. */
export const registerImport = registerImportSummary.extend({
  projectId: z.uuid(),
  sheet: z.string(),
  headerRow: z.int().min(1),
  headers: z.array(z.string()),
  mapping: registerImportMapping,
  rows: z.array(registerImportRow),
});
export type RegisterImport = z.infer<typeof registerImport>;

export const confirmedRegisterImport = z.object({ rowsCreated: z.int().min(0) });
export type ConfirmedRegisterImport = z.infer<typeof confirmedRegisterImport>;
