import { withMember, type Db } from "@rabaed/db";
import {
  registerImportMapping,
  registerTopRows,
  type BilingualText,
  type PreviewRegisterImportRequest,
  type ReadRegisterRequest,
  type RegisterImport,
  type RegisterImportFile,
  type RegisterImportMapping,
  type RegisterImportRowReason,
  type RegisterImportSummary,
  type RegisterSheet,
} from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome } from "../outcomes.ts";
import { getRaisableTypes } from "../work-items/work-items.ts";
import { openSpreadsheet, SpreadsheetError, type SheetTable, type Spreadsheet, type SpreadsheetRefusal } from "./spreadsheet.ts";

// The Submittal Register Import (RP-637, spec RP-631). The api reads the register
// (spreadsheet.ts), takes each row's Subject, Type and Trade from the mapped columns,
// and app.preview_register_import checks every row by the rules app.create_work_item
// enforces and keeps the import `previewed`; app.confirm_register_import creates the
// Drafts. Reads go through row-level security: only the importing Participant's
// Members read an import (visibility.md RP-589-1), a preview only its importer.

/** A register that can't be read, or a choice in it that doesn't fit (the reader's refusals, with its numbers). */
type Unreadable = { ok: false; reason: SpreadsheetRefusal; details?: Record<string, number> };
/** Not one of the caller's Projects; or one where they may raise no Submittals Type (story 4). */
type NotTheirs = { ok: false; reason: "not_found" | "forbidden" };

export type ReadRegisterResult = { ok: true; sheet: RegisterSheet } | Unreadable | NotTheirs;

const previewRefusals = ["not_found", "project_closed", "forbidden", "type_not_found", "trade_not_found"] as const;
export type PreviewRegisterImportResult =
  | { ok: true; id: string }
  | Unreadable
  | NotTheirs
  | { ok: false; reason: (typeof previewRefusals)[number] | "column_not_found" };

const confirmRefusals = ["not_found", "project_closed", "nothing_to_import", "preview_outdated"] as const;
export type ConfirmRegisterImportResult = { ok: true; rowsCreated: number } | { ok: false; reason: (typeof confirmRefusals)[number] };

/** Whether the Member may import on the Project: one of their Projects, with a Submittals Type they may raise. */
async function mayImport(db: Db, memberId: string, projectId: string): Promise<NotTheirs | null> {
  const raisable = await getRaisableTypes(db, memberId, projectId);
  if (!raisable) return { ok: false, reason: "not_found" };
  return raisable.types.length === 0 ? { ok: false, reason: "forbidden" } : null;
}

/** Runs `read` on the uploaded register, answering the reader's refusal as a result. */
async function readingRegister<T>(file: RegisterImportFile, read: (spreadsheet: Spreadsheet) => T): Promise<{ ok: true; value: T } | Unreadable> {
  try {
    const spreadsheet = await openSpreadsheet({ fileName: file.fileName, bytes: Buffer.from(file.content, "base64") });
    return { ok: true, value: read(spreadsheet) };
  } catch (error) {
    if (error instanceof SpreadsheetError) return { ok: false, reason: error.reason, ...(error.details ? { details: error.details } : {}) };
    throw error;
  }
}

/** Reads an uploaded register for the wizard: its sheets, one sheet's top rows, and its columns from the header row. */
export async function readRegister(db: Db, memberId: string, projectId: string, request: ReadRegisterRequest): Promise<ReadRegisterResult> {
  const refused = await mayImport(db, memberId, projectId);
  if (refused) return refused;
  const read = await readingRegister(request.file, (spreadsheet): RegisterSheet => {
    const table = spreadsheet.table({ sheet: request.sheet, headerRow: request.headerRow });
    const first = table.rows[0];
    return {
      sheets: spreadsheet.sheets.map((name, index) => ({ name, rows: spreadsheet.rowCounts[index]! })),
      sheet: table.sheet,
      headerRow: table.headerRow,
      top: spreadsheet.top(table.sheet, registerTopRows).map((row) => ({ rowNo: row.rowNo, cells: row.values })),
      headers: table.headers,
      examples: table.headers.map((_, column) => first?.values[column] ?? ""),
      dataRows: table.rows.length,
    };
  });
  return read.ok ? { ok: true, sheet: read.value } : read;
}

/** The rows as app.preview_register_import takes them: every cell, and the mapped Subject, Type and Trade as read. */
function mappedRows(table: SheetTable, mapping: RegisterImportMapping) {
  const cell = (values: string[], field: { column: number } | { value: string }) => ("column" in field ? (values[field.column] ?? "") : "");
  return table.rows.map((row) => ({
    row_no: row.rowNo,
    cells: row.values,
    subject: row.values[mapping.subject.column] ?? "",
    type: cell(row.values, mapping.type),
    trade: cell(row.values, mapping.trade),
  }));
}

/**
 * Previews an uploaded register: reads the sheet from the header row, maps each row,
 * and keeps the checked rows as a `previewed` import of the caller's Participant.
 * Nothing is created in the Project.
 */
export async function previewRegisterImport(
  db: Db,
  memberId: string,
  projectId: string,
  request: PreviewRegisterImportRequest,
  now: Date,
): Promise<PreviewRegisterImportResult> {
  const refused = await mayImport(db, memberId, projectId);
  if (refused) return refused;
  const read = await readingRegister(request.file, (spreadsheet) => spreadsheet.table({ sheet: request.sheet, headerRow: request.headerRow }));
  if (!read.ok) return read;
  const table = read.value;
  const { mapping } = request;
  const columns = [mapping.subject, mapping.type, mapping.trade].flatMap((field) => ("column" in field ? [field.column] : []));
  if (columns.some((column) => column >= table.headers.length)) return { ok: false, reason: "column_not_found" };
  return withMember(db, memberId, async (trx): Promise<PreviewRegisterImportResult> => {
    const { rows } = await sql<{ outcome: string; import_id: string | null }>`
      select outcome, import_id from app.preview_register_import(
        ${projectId}::uuid, ${request.file.fileName}, ${table.sheet}, ${table.headerRow}, ${JSON.stringify(table.headers)}::jsonb,
        ${JSON.stringify(mapping)}::jsonb, ${JSON.stringify(mappedRows(table, mapping))}::jsonb,
        ${"value" in mapping.type ? mapping.type.value : null}, ${"value" in mapping.trade ? mapping.trade.value : null}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["previewed", ...previewRefusals]);
    return outcome === "previewed" ? { ok: true, id: rows[0]!.import_id! } : { ok: false, reason: outcome };
  });
}

type SummaryRow = {
  id: string;
  file_name: string;
  status: "previewed" | "created";
  run_by_member_id: string;
  run_by_name: BilingualText;
  rows_total: number;
  rows_rejected: number;
  rows_created: number | null;
};

const toSummary = (r: SummaryRow): RegisterImportSummary => ({
  id: r.id,
  fileName: r.file_name,
  status: r.status,
  runBy: { id: r.run_by_member_id, name: r.run_by_name },
  rowsTotal: r.rows_total,
  rowsRejected: r.rows_rejected,
  rowsCreated: r.rows_created,
});

/**
 * The Project's imports of the Member's own Participant, confirmed ones only (a preview
 * leaves no trace), by file name: never by when, which is when their Drafts were
 * started (scenario 61). Null when it isn't one of their Projects.
 */
export function listRegisterImports(db: Db, memberId: string, projectId: string): Promise<RegisterImportSummary[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    const { rows } = await sql<SummaryRow>`
      select i.id, i.file_name, i.status, i.run_by_member_id, m.full_name as run_by_name, i.rows_total, i.rows_rejected, i.rows_created
      from submittal_register_import i
      join member m on m.id = i.run_by_member_id
      where i.project_id = ${projectId}::uuid and i.status = 'created'
      order by lower(i.file_name), i.id
    `.execute(trx);
    return rows.map(toSummary);
  });
}

/** One import the Member reads, with its rows; null when they don't (another Company's, a colleague's preview, or none). */
export function getRegisterImport(db: Db, memberId: string, importId: string): Promise<RegisterImport | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows: found } = await sql<SummaryRow & { project_id: string; sheet: string; header_row: number; headers: string[]; mapping: unknown }>`
      select i.id, i.project_id, i.file_name, i.status, i.run_by_member_id, m.full_name as run_by_name,
        i.rows_total, i.rows_rejected, i.rows_created, i.sheet, i.header_row, i.headers, i.mapping
      from submittal_register_import i
      join member m on m.id = i.run_by_member_id
      where i.id = ${importId}::uuid
    `.execute(trx);
    const r = found[0];
    if (!r) return null;
    const { rows } = await sql<{
      row_no: number;
      cells: string[];
      subject: string;
      type_text: string;
      type_code: string | null;
      type_name: BilingualText | null;
      trade_text: string;
      trade_id: string | null;
      trade_code: string | null;
      trade_name: BilingualText | null;
      reasons: RegisterImportRowReason[];
      created: boolean;
      work_item_id: string | null;
    }>`
      select r.row_no, r.cells, r.subject, r.type_text, t.code as type_code, t.name as type_name,
        r.trade_text, tv.id as trade_id, tv.code as trade_code, tv.name as trade_name, r.reasons,
        res.created, res.work_item_id
      from submittal_register_import_row r
      join app.register_import_results(${importId}::uuid) res on res.row_no = r.row_no
      left join work_item_type t on t.id = r.work_item_type_id
      left join dimension_value tv on tv.id = r.trade_id
      where r.import_id = ${importId}::uuid
      order by r.row_no
    `.execute(trx);
    return {
      ...toSummary(r),
      projectId: r.project_id,
      sheet: r.sheet,
      headerRow: r.header_row,
      headers: r.headers,
      mapping: registerImportMapping.parse(r.mapping),
      rows: rows.map((row) => ({
        rowNo: row.row_no,
        cells: row.cells,
        subject: row.subject,
        type: { text: row.type_text, match: row.type_code ? { code: row.type_code, name: row.type_name! } : null },
        trade: { text: row.trade_text, match: row.trade_id ? { id: row.trade_id, code: row.trade_code!, name: row.trade_name! } : null },
        reasons: row.reasons,
        created: row.created,
        workItemId: row.work_item_id,
      })),
    };
  });
}

/** Creates the Drafts of the Member's own preview: one per good row, all or nothing. */
export function confirmRegisterImport(db: Db, memberId: string, importId: string, now: Date): Promise<ConfirmRegisterImportResult> {
  return withMember(db, memberId, async (trx): Promise<ConfirmRegisterImportResult> => {
    const { rows } = await sql<{ outcome: string; rows_created: number | null }>`
      select outcome, rows_created from app.confirm_register_import(${importId}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...confirmRefusals]);
    return outcome === "created" ? { ok: true, rowsCreated: rows[0]!.rows_created! } : { ok: false, reason: outcome };
  });
}
