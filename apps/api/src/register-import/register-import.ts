import { withMember, type Database, type Db } from "@rabaed/db";
import {
  registerImportMapping,
  registerTopRows,
  suggestRegisterFields,
  type BilingualText,
  type PreviewRegisterImportRequest,
  type ReadRegisterRequest,
  type RegisterImport,
  type RegisterImportFields,
  type RegisterImportFile,
  type RegisterImportMapping,
  type RegisterImportRowReason,
  type RegisterImportSummary,
  type RegisterSheet,
  type RegisterValues,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";
import { checkedOutcome } from "../outcomes.ts";
import { fieldTargets, mappedRows, registerContext, registerValues, type RegisterContext } from "./matching.ts";
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
  | { ok: false; reason: (typeof previewRefusals)[number] | "column_not_found" | "field_not_found" };

const confirmRefusals = ["not_found", "project_closed", "nothing_to_import", "preview_outdated"] as const;
export type ConfirmRegisterImportResult = { ok: true; rowsCreated: number } | { ok: false; reason: (typeof confirmRefusals)[number] };

/**
 * Whether the Member may import on the Project: one of their Projects, with a Submittals Type
 * they may raise by the rule the preview and the confirm check (app.register_import_raisable_types).
 */
function mayImport(db: Db, memberId: string, projectId: string): Promise<NotTheirs | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { ok: false, reason: "not_found" };
    const { rows } = await sql<{ raisable: number }>`
      select count(*)::int as raisable from app.register_import_raisable_types(${projectId}::uuid)
    `.execute(trx);
    return rows[0]!.raisable === 0 ? { ok: false, reason: "forbidden" } : null;
  });
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

/**
 * Reads an uploaded register for the wizard: its sheets, one sheet's top rows, its columns
 * from the header row, and a field suggested for each column from its heading (RP-639).
 */
export async function readRegister(db: Db, memberId: string, projectId: string, request: ReadRegisterRequest): Promise<ReadRegisterResult> {
  const refused = await mayImport(db, memberId, projectId);
  if (refused) return refused;
  const read = await readingRegister(request.file, (spreadsheet) => ({ spreadsheet, table: spreadsheet.table({ sheet: request.sheet, headerRow: request.headerRow }) }));
  if (!read.ok) return read;
  const { spreadsheet, table } = read.value;
  const targets = await withMember(db, memberId, async (trx) => fieldTargets(await registerContext(trx, projectId)));
  const first = table.rows[0];
  return {
    ok: true,
    sheet: {
      sheets: spreadsheet.sheets.map((name, index) => ({ name, rows: spreadsheet.rowCounts[index]! })),
      sheet: table.sheet,
      headerRow: table.headerRow,
      top: spreadsheet.top(table.sheet, registerTopRows).map((row) => ({ rowNo: row.rowNo, cells: row.values })),
      headers: table.headers,
      examples: table.headers.map((_, column) => first?.values[column] ?? ""),
      dataRows: table.rows.length,
      suggestions: suggestRegisterFields(table.headers, targets),
    },
  };
}

/** What a register may fill on one of the Member's Projects (the Map fields and Map values steps). */
export async function getRegisterImportFields(db: Db, memberId: string, projectId: string): Promise<RegisterImportFields | NotTheirs> {
  const refused = await mayImport(db, memberId, projectId);
  if (refused) return refused;
  return withMember(db, memberId, async (trx) => (await registerContext(trx, projectId)).fields);
}

/** Every column the mapping names. */
const mappedColumns = (mapping: RegisterImportMapping) =>
  [mapping.subject, mapping.type, mapping.trade, mapping.scopes, mapping.location, mapping.paperRef, ...(mapping.fields ?? [])].flatMap((field) =>
    field && "column" in field ? [field.column] : [],
  );

/** Reads the mapped sheet of an uploaded register, refusing a mapping to a column past its header row's. */
async function mappedTable(request: PreviewRegisterImportRequest): Promise<{ ok: true; table: SheetTable } | Unreadable | { ok: false; reason: "column_not_found" }> {
  const read = await readingRegister(request.file, (spreadsheet) => spreadsheet.table({ sheet: request.sheet, headerRow: request.headerRow }));
  if (!read.ok) return read;
  if (mappedColumns(request.mapping).some((column) => column >= read.value.headers.length)) return { ok: false, reason: "column_not_found" };
  return { ok: true, table: read.value };
}

/** The mapping with each Form field's label as the Form names it; null when one is no field a register can fill. */
function labelled(mapping: RegisterImportMapping, context: RegisterContext): RegisterImportMapping | null {
  const fields = (mapping.fields ?? []).map((f) => {
    const fillable = context.fillable.get(f.key);
    return fillable ? { key: f.key, column: f.column, label: fillable.field.label } : null;
  });
  if (fields.includes(null)) return null;
  return mapping.fields ? { ...mapping, fields: fields as NonNullable<RegisterImportMapping["fields"]> } : mapping;
}

/**
 * Map values (RP-639, story 10): each mapped column of a value field, every different
 * value in it once, with how many rows hold it and what it matches.
 */
export async function registerImportValues(
  db: Db,
  memberId: string,
  projectId: string,
  request: PreviewRegisterImportRequest,
): Promise<{ ok: true; values: RegisterValues } | Unreadable | NotTheirs | { ok: false; reason: "column_not_found" | "field_not_found" }> {
  const refused = await mayImport(db, memberId, projectId);
  if (refused) return refused;
  const mapped = await mappedTable(request);
  if (!mapped.ok) return mapped;
  return withMember(db, memberId, async (trx) => {
    const context = await registerContext(trx, projectId);
    const mapping = labelled(request.mapping, context);
    if (!mapping) return { ok: false, reason: "field_not_found" } as const;
    return { ok: true, values: registerValues(mapped.table, mapping, context) } as const;
  });
}

/**
 * Previews an uploaded register: reads the sheet from the header row, maps and matches
 * each row, and keeps the checked rows as a `previewed` import of the caller's
 * Participant. Nothing is created in the Project.
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
  const mapped = await mappedTable(request);
  if (!mapped.ok) return mapped;
  const { table } = mapped;
  return withMember(db, memberId, async (trx): Promise<PreviewRegisterImportResult> => {
    const context = await registerContext(trx, projectId);
    const mapping = labelled(request.mapping, context);
    if (!mapping) return { ok: false, reason: "field_not_found" };
    const { rows } = await sql<{ outcome: string; import_id: string | null }>`
      select outcome, import_id from app.preview_register_import(
        ${projectId}::uuid, ${request.file.fileName}, ${table.sheet}, ${table.headerRow}, ${JSON.stringify(table.headers)}::jsonb,
        ${JSON.stringify(mapping)}::jsonb, ${JSON.stringify(mappedRows(table, mapping, context))}::jsonb,
        ${"value" in mapping.type ? mapping.type.value : null}, ${"value" in mapping.trade ? mapping.trade.value : null}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["previewed", ...previewRefusals]);
    return outcome === "previewed" ? { ok: true, id: rows[0]!.import_id! } : { ok: false, reason: outcome };
  });
}

type ImportRow = {
  id: string;
  project_id: string;
  file_name: string;
  status: "previewed" | "created";
  run_by_member_id: string;
  run_by_name: BilingualText;
  rows_total: number;
  rows_rejected: number;
  rows_created: number | null;
  sheet: string;
  header_row: number;
  headers: string[];
  mapping: unknown;
};
type Trx = Transaction<Database>;
type SummaryRow = Omit<ImportRow, "project_id" | "sheet" | "header_row" | "headers" | "mapping">;

/** The imports the Member reads (row-level security) matching `where`, by file name, with who ran each. */
function importsWhere(trx: Trx, where: RawBuilder<unknown>): Promise<ImportRow[]> {
  return sql<ImportRow>`
    select i.id, i.project_id, i.file_name, i.status, i.run_by_member_id, m.full_name as run_by_name,
      i.rows_total, i.rows_rejected, i.rows_created, i.sheet, i.header_row, i.headers, i.mapping
    from submittal_register_import i
    join member m on m.id = i.run_by_member_id
    where ${where}
    order by lower(i.file_name), i.id
  `
    .execute(trx)
    .then((r) => r.rows);
}

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
    return (await importsWhere(trx, sql`i.project_id = ${projectId}::uuid and i.status = 'created'`)).map(toSummary);
  });
}

/** One import the Member reads, with its rows; null when they don't (another Company's, a colleague's preview, or none). */
export function getRegisterImport(db: Db, memberId: string, importId: string): Promise<RegisterImport | null> {
  return withMember(db, memberId, async (trx) => {
    const [r] = await importsWhere(trx, sql`i.id = ${importId}::uuid`);
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
      location_text: string;
      location_id: string | null;
      location_code: string | null;
      location_name: BilingualText | null;
      scopes_text: string;
      scopes: { id: string; name: BilingualText }[];
      paper_ref: string;
      field_cells: Record<string, string>;
      invalid_fields: string[];
      reasons: RegisterImportRowReason[];
      created: boolean;
      work_item_id: string | null;
    }>`
      select r.row_no, r.cells, r.subject, r.type_text, t.code as type_code, t.name as type_name,
        r.trade_text, tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
        r.location_text, lv.id as location_id, lv.code as location_code, lv.name as location_name,
        r.scopes_text, coalesce((
          select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by x.n)
          from unnest(r.scope_ids) with ordinality x (id, n) join scope s on s.id = x.id
        ), '[]'::jsonb) as scopes,
        r.paper_ref, r.field_cells, r.invalid_fields, r.reasons,
        res.created, res.work_item_id
      from submittal_register_import_row r
      join app.register_import_results(${importId}::uuid) res on res.row_no = r.row_no
      left join work_item_type t on t.id = r.work_item_type_id
      left join dimension_value tv on tv.id = r.trade_id
      left join dimension_value lv on lv.id = r.location_id
      where r.import_id = ${importId}::uuid
      order by r.row_no
    `.execute(trx);
    const mapping = registerImportMapping.parse(r.mapping);
    const fieldKeys = (mapping.fields ?? []).map((f) => f.key);
    return {
      ...toSummary(r),
      projectId: r.project_id,
      sheet: r.sheet,
      headerRow: r.header_row,
      headers: r.headers,
      mapping,
      rows: rows.map((row) => ({
        rowNo: row.row_no,
        cells: row.cells,
        subject: row.subject,
        type: { text: row.type_text, match: row.type_code ? { code: row.type_code, name: row.type_name! } : null },
        trade: { text: row.trade_text, match: row.trade_id ? { id: row.trade_id, code: row.trade_code!, name: row.trade_name! } : null },
        location: { text: row.location_text, match: row.location_id ? { id: row.location_id, code: row.location_code!, name: row.location_name! } : null },
        scopes: { text: row.scopes_text, matches: row.scopes },
        paperRef: row.paper_ref,
        // The mapped Form fields its Type's Form has, in the mapping's order.
        fields: fieldKeys
          .filter((key) => key in row.field_cells)
          .map((key) => ({ key, text: row.field_cells[key]!, invalid: row.invalid_fields.includes(key) })),
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
