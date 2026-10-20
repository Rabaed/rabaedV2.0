import { randomUUID } from "node:crypto";
import { withMember, type Database, type Db } from "@rabaed/db";
import {
  packageNumber,
  registerImportMapping,
  registerTopRows,
  rowUsesSuggestion,
  suggestRegisterFields,
  xlsxContentType,
  type BilingualText,
  type PackageStatus,
  type RegisterImportMappings,
  type SaveRegisterImportMappingRequest,
  type PreviewRegisterImportRequest,
  type ReadRegisterRequest,
  type RegisterImport,
  type RegisterImportFields,
  type RegisterImportFile,
  type RegisterImportListed,
  type RegisterImportMapping,
  type RegisterImportRowReason,
  type RegisterImportSummary,
  type RegisterSheet,
  type RegisterValues,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { checkedOutcome } from "../outcomes.ts";
import { fieldTargets, mappedRows, registerContext, registerValues, savedMappingsOf, type RegisterContext } from "./matching.ts";
import { openSpreadsheet, SpreadsheetError, type SheetTable, type Spreadsheet, type SpreadsheetRefusal } from "./spreadsheet.ts";

// The Submittal Register Import (RP-637, spec RP-631). The api reads the register
// (spreadsheet.ts), takes each row's Subject, Type and Trade from the mapped columns,
// and app.preview_register_import checks every row by the rules app.create_work_item
// enforces and keeps the import `previewed`; app.confirm_register_import creates the
// Drafts. Reads go through row-level security: only the importing Participant's
// Members read an import (visibility.md RP-589-1), a preview only its importer.
//
// The one import, for two importers (RP-645): a Member importing their own Company's
// register (the api's routes), and a Rabaed Engineer importing it for a Participant in
// Rabaed Admin, which runs this very code as the Participant's default Member, who stands
// where the importer stands. Every check is the same; the import is the Engineer's, which
// the Company reads as "Rabaed" (visibility.md RP-589-3). Rabaed Admin runs each step as the
// app role (RP-960), so every read here is held to row-level security as the default Member;
// only what is the Engineer's alone runs on Rabaed Admin's own role, past it, through
// `engineer.own`. Each read still says whose it is (the session's Member's Projects,
// Participant, Visibility), or goes through a function that does, never leaning on a policy.

type Trx = Transaction<Database>;

/**
 * The Rabaed Engineer importing (Rabaed Admin). The step runs as the app role; `own` runs
 * what is the Engineer's alone (their `_by_engineer` functions, their own import's header and
 * rows, which no Member reads) on Rabaed Admin's role, in the same transaction, then returns
 * to the app role. Nothing else may go through it.
 */
export interface ImportingEngineer {
  id: string;
  own<T>(trx: Trx, fn: (trx: Trx) => Promise<T>): Promise<T>;
}

/**
 * Who imports, and the transaction an import step runs in, with `app.member_id` set:
 * the Member importing (memberImporter), or the default Member a Rabaed Engineer imports
 * for (Rabaed Admin, which logs each step as an admin_action with the Engineer's reason).
 * Each step runs exactly one transaction, as the app role, answering an `R` (what Rabaed
 * Admin logs of it).
 */
export interface RegisterImporter<R = unknown> {
  run<T extends R>(fn: (trx: Trx) => Promise<T>): Promise<T>;
  /** The Rabaed Engineer importing; null for a Member's own import. */
  engineer: ImportingEngineer | null;
  /**
   * Where a preview's original register is kept, under the Project's prefix (RP-644, story 34):
   * the api's file store. Rabaed Admin has none: an Engineer's preview hands its original over
   * through the database instead, and the api stores it at the first download (RP-959).
   */
  files?: FileStore;
}

/**
 * An importer who previews: a Rabaed Engineer names the Participant they import for (reading
 * or confirming their own import, the import names it); a Member imports for their own.
 */
export type PreviewingImporter = RegisterImporter<PreviewRegisterImportResult> & { engineer: (ImportingEngineer & { participantId: string }) | null };

/** A Member importing their own Company's register: each step one transaction as them, through row-level security. */
export const memberImporter = (db: Db, memberId: string, files?: FileStore): RegisterImporter & { engineer: null } => ({
  run: (fn) => withMember(db, memberId, fn),
  engineer: null,
  ...(files ? { files } : {}),
});

/** A register that can't be read, or a choice in it that doesn't fit (the reader's refusals, with its numbers). */
type Unreadable = { ok: false; reason: SpreadsheetRefusal; details?: Record<string, number> };
/** Not one of the caller's Projects; or one where they may raise no Submittals Type (story 4). */
type NotTheirs = { ok: false; reason: "not_found" | "forbidden" };

export type ReadRegisterResult = { ok: true; sheet: RegisterSheet } | Unreadable | NotTheirs;

const previewRefusals = ["not_found", "project_closed", "forbidden", "type_not_found", "trade_not_found", "package_not_found"] as const;
/**
 * What became of a preview's original register: stored in the file store (a Member's), handed
 * over for the api to store (a Rabaed Engineer's, RP-959), or not kept (no file store set up).
 */
export type RegisterImportOriginalKept = "stored" | "handed_over" | "none";
export type PreviewRegisterImportResult =
  | { ok: true; id: string; original: RegisterImportOriginalKept }
  | Unreadable
  | NotTheirs
  | { ok: false; reason: (typeof previewRefusals)[number] | "column_not_found" | "field_not_found" };

const confirmRefusals = ["not_found", "project_closed", "nothing_to_import", "preview_outdated"] as const;
export type ConfirmRegisterImportResult = { ok: true; rowsCreated: number } | { ok: false; reason: (typeof confirmRefusals)[number] };

/**
 * Whether the importer may import on the Project: one of their Projects, with a Submittals Type
 * they may raise by the rule the preview and the confirm check (app.register_import_raisable_types).
 */
async function mayImport(trx: Trx, projectId: string): Promise<NotTheirs | null> {
  // The project table's policy, said again: Rabaed Admin reads past it as the default Member.
  const project = await trx
    .selectFrom("project")
    .select("id")
    .where("id", "=", projectId)
    .where(sql<boolean>`id in (select app.current_project_ids())`)
    .executeTakeFirst();
  if (!project) return { ok: false, reason: "not_found" };
  const { rows } = await sql<{ raisable: number }>`
    select count(*)::int as raisable from app.register_import_raisable_types(${projectId}::uuid)
  `.execute(trx);
  return rows[0]!.raisable === 0 ? { ok: false, reason: "forbidden" } : null;
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
export function readRegister(importer: RegisterImporter, projectId: string, request: ReadRegisterRequest): Promise<ReadRegisterResult> {
  return importer.run(async (trx): Promise<ReadRegisterResult> => {
    const refused = await mayImport(trx, projectId);
    if (refused) return refused;
    const read = await readingRegister(request.file, (spreadsheet) => ({ spreadsheet, table: spreadsheet.table({ sheet: request.sheet, headerRow: request.headerRow }) }));
    if (!read.ok) return read;
    const { spreadsheet, table } = read.value;
    const targets = fieldTargets(await registerContext(trx, projectId));
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
  });
}

/** What a register may fill on one of the importer's Projects (the Map fields and Map values steps). */
export function getRegisterImportFields(importer: RegisterImporter, projectId: string): Promise<RegisterImportFields | NotTheirs> {
  return importer.run(async (trx) => (await mayImport(trx, projectId)) ?? (await registerContext(trx, projectId)).fields);
}

/** Every column the mapping names. */
const mappedColumns = (mapping: RegisterImportMapping) =>
  [mapping.subject, mapping.type, mapping.trade, mapping.scopes, mapping.location, mapping.package, mapping.paperRef, mapping.assignTo, ...(mapping.fields ?? [])].flatMap((field) =>
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
export type RegisterImportValuesResult =
  | { ok: true; values: RegisterValues }
  | Unreadable
  | NotTheirs
  | { ok: false; reason: "column_not_found" | "field_not_found" };

export function registerImportValues(importer: RegisterImporter, projectId: string, request: PreviewRegisterImportRequest): Promise<RegisterImportValuesResult> {
  return importer.run(async (trx) => {
    const refused = await mayImport(trx, projectId);
    if (refused) return refused;
    const mapped = await mappedTable(request);
    if (!mapped.ok) return mapped;
    const context = await registerContext(trx, projectId);
    const mapping = labelled(request.mapping, context);
    if (!mapping) return { ok: false, reason: "field_not_found" } as const;
    return { ok: true, values: registerValues(mapped.table, mapping, context) } as const;
  });
}

/**
 * Previews an uploaded register: reads the sheet from the header row, maps and matches
 * each row, and keeps the checked rows as a `previewed` import of the importer's
 * Participant (an Engineer's for the Participant they import for). Nothing is created in
 * the Project.
 */
export function previewRegisterImport(
  importer: PreviewingImporter,
  projectId: string,
  request: PreviewRegisterImportRequest,
  now: Date,
): Promise<PreviewRegisterImportResult> {
  return importer.run(async (trx): Promise<PreviewRegisterImportResult> => {
    const refused = await mayImport(trx, projectId);
    if (refused) return refused;
    const mapped = await mappedTable(request);
    if (!mapped.ok) return mapped;
    const { table } = mapped;
    const context = await registerContext(trx, projectId);
    const mapping = labelled(request.mapping, context);
    if (!mapping) return { ok: false, reason: "field_not_found" };
    const args = sql`${projectId}::uuid, ${request.file.fileName}, ${table.sheet}, ${table.headerRow}, ${JSON.stringify(table.headers)}::jsonb,
        ${JSON.stringify(mapping)}::jsonb, ${JSON.stringify(mappedRows(table, mapping, context))}::jsonb,
        ${"value" in mapping.type ? mapping.type.value : null}, ${"value" in mapping.trade ? mapping.trade.value : null}::uuid, ${now}`;
    const { engineer } = importer;
    const { rows } = await (engineer
      ? engineer.own(trx, (own) =>
          sql<{ outcome: string; import_id: string | null }>`
            select outcome, import_id from app.preview_register_import_by_engineer(${engineer.id}::uuid, ${engineer.participantId}::uuid, ${args})`.execute(own),
        )
      : sql<{ outcome: string; import_id: string | null }>`select outcome, import_id from app.preview_register_import(${args})`.execute(trx));
    const outcome = checkedOutcome(rows[0]!.outcome, ["previewed", ...previewRefusals]);
    if (outcome !== "previewed") return { ok: false, reason: outcome };
    const importId = rows[0]!.import_id!;
    const original = engineer
      ? await engineer.own(trx, (own) => handOverOriginal(own, engineer.id, importId, request.file))
      : importer.files
        ? await keepOriginal(trx, importer.files, projectId, importId, request.file)
        : "none";
    return { ok: true, id: importId, original };
  });
}

/** The media type a register is downloaded as, by its extension. */
const registerContentType = (fileName: string) => (/\.csv$/i.test(fileName) ? "text/csv; charset=utf-8" : xlsxContentType);

/**
 * Keeps a Member's previewed register as its original (RP-644, story 34), under the Project's
 * prefix (ADR 0007), and deletes the files of the previews cleaned up since (the worker can't).
 */
async function keepOriginal(trx: Trx, files: FileStore, projectId: string, importId: string, file: RegisterImportFile): Promise<"stored"> {
  const fileId = randomUUID();
  const { rows } = await sql<{ key: string }>`select app.register_import_file_key(${projectId}::uuid, ${importId}::uuid, ${fileId}::uuid) as key`.execute(trx);
  await files.put(rows[0]!.key, Buffer.from(file.content, "base64"), registerContentType(file.fileName));
  const { rows: stored } = await sql<{ outcome: string }>`select app.store_register_import_file(${importId}::uuid, ${fileId}::uuid) as outcome`.execute(trx);
  checkedOutcome(stored[0]!.outcome, ["stored"]);
  // A file the store fails to delete never fails the Member's preview: it stays, unread (its key is gone).
  const { rows: gone } = await sql<{ key: string }>`select app.take_register_import_file_removals(100) as key`.execute(trx);
  await Promise.allSettled(gone.map(({ key }) => files.remove(key)));
  return "stored";
}

/**
 * Hands a Rabaed Engineer's previewed register over as its original (RP-959): Rabaed Admin has no
 * file store and no way to the api (ADR 0010), so the file waits in the database, the Engineer's
 * own (`engineer.own`), until the api stores it at the first download (registerImportOriginal).
 */
async function handOverOriginal(trx: Trx, engineerId: string, importId: string, file: RegisterImportFile): Promise<"handed_over"> {
  const { rows } = await sql<{ outcome: string }>`
    select app.hand_over_register_import_original_by_engineer(${engineerId}::uuid, ${importId}::uuid, ${Buffer.from(file.content, "base64")}) as outcome
  `.execute(trx);
  return checkedOutcome(rows[0]!.outcome, ["handed_over"]);
}

/** An import's original register, as its reader downloads it: its name as uploaded, never a time. */
export type RegisterImportOriginal = { fileName: string; contentType: string; bytes: Uint8Array };

/**
 * The original register of an import the Member reads (RP-644, story 34); null when they
 * don't read it, or it keeps none (a file no longer stored). A Rabaed Engineer's, handed over
 * through the database, is stored here at its first download, under the import's key (RP-959).
 */
export function registerImportOriginal(importer: RegisterImporter, importId: string): Promise<RegisterImportOriginal | null> {
  return importer.run(async (trx) => {
    const files = importer.files;
    if (!files || importer.engineer) return null;
    const [r] = await importsWhere(trx, importer, sql`i.id = ${importId}::uuid`);
    if (!r?.source_file_id) return null;
    const { rows } = await sql<{ key: string }>`select app.register_import_file_key(${r.project_id}::uuid, ${r.id}::uuid, ${r.source_file_id}::uuid) as key`.execute(trx);
    const key = rows[0]!.key;
    const contentType = registerContentType(r.file_name);
    // Taken off the hand-over in this transaction: a store that fails leaves it there for the next download.
    const { rows: handed } = await sql<{ bytes: Buffer | null }>`select app.take_register_import_original_hand_over(${r.id}::uuid) as bytes`.execute(trx);
    const handedOver = handed[0]?.bytes;
    if (handedOver) await files.put(key, handedOver, contentType);
    const bytes = handedOver ?? (await files.read(key));
    return bytes ? { fileName: r.file_name, contentType, bytes } : null;
  });
}

type ImportRow = {
  id: string;
  project_id: string;
  file_name: string;
  status: "previewed" | "created";
  run_by_member_id: string | null;
  run_by_name: BilingualText | null;
  /** Who raises its unassigned rows: the importing Member, or an Engineer's default Member. */
  raiser_id: string;
  raiser_name: BilingualText;
  rows_total: number;
  rows_rejected: number;
  rows_created: number | null;
  sheet: string;
  header_row: number;
  headers: string[];
  mapping: unknown;
  /** Its original register as stored (RP-644), or handed over by Rabaed Admin for the api to store (RP-959); null when it keeps none. */
  source_file_id: string | null;
};
type SummaryRow = Omit<ImportRow, "project_id" | "sheet" | "header_row" | "headers" | "mapping" | "raiser_id" | "raiser_name" | "source_file_id">;

/**
 * Which imports the importer reads: the table's policy, said again, because Rabaed Admin
 * reads past it as the default Member. An import of their own Participant on one of their
 * Projects, confirmed or their own preview; an Engineer only their own, made for this
 * default Member.
 */
const readBy = (importer: Pick<RegisterImporter, "engineer">) => sql`
  i.participant_id in (select app.current_participant_ids()) and i.project_id in (select app.current_project_ids())
  and ${
    importer.engineer
      ? sql`i.run_by_engineer_id = ${importer.engineer.id}::uuid and i.default_member_id = app.current_member_id()`
      : sql`(i.status = 'created' or i.run_by_member_id = app.current_member_id())`
  }`;

/**
 * The imports the importer reads (readBy) matching `where`, by file name, with the Member
 * who ran each: none for an Engineer's ("Rabaed").
 */
function importsWhere(trx: Trx, importer: Pick<RegisterImporter, "engineer">, where: RawBuilder<unknown>): Promise<ImportRow[]> {
  return sql<ImportRow>`
    select i.id, i.project_id, i.file_name, i.status, i.run_by_member_id, m.full_name as run_by_name,
      r.id as raiser_id, r.full_name as raiser_name,
      i.rows_total, i.rows_rejected, i.rows_created, i.sheet, i.header_row, i.headers, i.mapping, i.source_file_id
    from submittal_register_import i
    left join member m on m.id = i.run_by_member_id
    join member r on r.id = coalesce(i.run_by_member_id, i.default_member_id)
    where ${readBy(importer)} and ${where}
    order by lower(i.file_name), i.id
  `
    .execute(trx)
    .then((r) => r.rows);
}

const toSummary = (r: SummaryRow): RegisterImportSummary => ({
  id: r.id,
  fileName: r.file_name,
  status: r.status,
  runBy: r.run_by_member_id && r.run_by_name ? { id: r.run_by_member_id, name: r.run_by_name } : null,
  rowsTotal: r.rows_total,
  rowsRejected: r.rows_rejected,
  rowsCreated: r.rows_created,
});

/**
 * The Project's imports of the Member's own Participant, confirmed ones only (a preview
 * leaves no trace), by file name: never by when, which is when their Drafts were
 * started (scenario 61). Any Member of it reads them, one who may not import too (story 32),
 * each with the Packages its Drafts went to. Null when it isn't one of their Projects.
 */
export function listRegisterImports(db: Db, memberId: string, projectId: string): Promise<RegisterImportListed[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    const imports = await importsWhere(trx, { engineer: null }, sql`i.project_id = ${projectId}::uuid and i.status = 'created'`);
    // A confirmed import created a Draft from every good row (all or nothing); the Packages are
    // the importing Participant's own, by the function (as on the import's page).
    const { rows } = await sql<{ import_id: string; package_id: string; seq: number; name: BilingualText; status: PackageStatus }>`
      select distinct r.import_id, k.package_id, k.seq, k.name, k.status
      from submittal_register_import_row r
      join app.register_import_packages(${projectId}::uuid) k on k.package_id = r.package_id
      where r.import_id = any(${imports.map((i) => i.id)}::uuid[]) and cardinality(r.reasons) = 0
      order by k.seq
    `.execute(trx);
    return imports.map((i) => ({
      ...toSummary(i),
      packages: rows
        .filter((k) => k.import_id === i.id)
        .map((k) => ({ id: k.package_id, number: packageNumber(k.seq), name: k.name, status: k.status })),
    }));
  });
}

/** An import's rows as stored, with whether each created a Draft and that Draft where the reader sees it. */
const storedRowColumns = `row_no integer, cells jsonb, subject text, type_text text, work_item_type_id uuid, trade_text text, trade_id uuid,
  location_text text, location_id uuid, scopes_text text, scope_ids uuid[], paper_ref text, field_cells jsonb, invalid_fields text[],
  assignee_text text, assignee_member_id uuid, reasons text[], package_text text, package_id uuid, package_name text,
  created boolean, work_item_id uuid`;

/** The rows of an import the reader reads, as stored, joined to `results` (its importer's app.register_import_results). */
async function storedRows(trx: Trx, importId: string, results: RawBuilder<unknown>): Promise<Record<string, unknown>[]> {
  const { rows } = await sql<Record<string, unknown>>`
    select r.row_no, r.cells, r.subject, r.type_text, r.work_item_type_id, r.trade_text, r.trade_id,
      r.location_text, r.location_id, r.scopes_text, r.scope_ids, r.paper_ref, r.field_cells, r.invalid_fields,
      r.assignee_text, r.assignee_member_id, r.reasons, r.package_text, r.package_id, r.package_name,
      res.created, res.work_item_id
    from submittal_register_import_row r
    join ${results} res on res.row_no = r.row_no
    where r.import_id = ${importId}::uuid
  `.execute(trx);
  return rows;
}

/**
 * One import the importer reads, with its rows; null when they don't (another Company's, a
 * colleague's preview, or none). An Engineer reads only their own (Rabaed Admin).
 */
export function getRegisterImport(importer: RegisterImporter, importId: string): Promise<RegisterImport | null> {
  return importer.run(async (trx) => {
    const { engineer } = importer;
    const which = sql`i.id = ${importId}::uuid`;
    // An Engineer's import is theirs alone: no Member reads its header or rows (a preview is its
    // importer's, and the Engineer is none of the Company's), so they are read on Rabaed Admin's
    // role, scoped to the Engineer and the default Member (readBy, the `_by_engineer` results).
    // What its rows name is looked up below as the app role, as for a Member's.
    const [r] = engineer ? await engineer.own(trx, (own) => importsWhere(own, importer, which)) : await importsWhere(trx, importer, which);
    if (!r) return null;
    const stored = engineer
      ? await engineer.own(trx, (own) => storedRows(own, importId, sql`app.register_import_results_by_engineer(${engineer.id}::uuid, ${importId}::uuid)`))
      : await storedRows(trx, importId, sql`app.register_import_results(${importId}::uuid)`);
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
      assignee_text: string;
      assignee_id: string | null;
      assignee_name: BilingualText | null;
      reasons: RegisterImportRowReason[];
      created: boolean;
      work_item_id: string | null;
      package_text: string;
      package_id: string | null;
      package_seq: number | null;
      package_name: BilingualText | null;
      package_status: PackageStatus | null;
      package_new: string | null;
    }>`
      select r.row_no, r.cells, r.subject, r.type_text, t.code as type_code, t.name as type_name,
        r.trade_text, tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
        r.location_text, lv.id as location_id, lv.code as location_code, lv.name as location_name,
        r.scopes_text, coalesce((
          select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by x.n)
          from unnest(r.scope_ids) with ordinality x (id, n) join scope s on s.id = x.id
        ), '[]'::jsonb) as scopes,
        r.paper_ref, r.field_cells, r.invalid_fields, r.assignee_text, am.id as assignee_id, am.full_name as assignee_name, r.reasons,
        r.created, r.work_item_id,
        r.package_text, k.package_id, k.seq as package_seq, k.name as package_name, k.status as package_status, r.package_name as package_new
      from jsonb_to_recordset(${JSON.stringify(stored)}::jsonb) as r (${sql.raw(storedRowColumns)})
      left join work_item_type t on t.id = r.work_item_type_id
      left join dimension_value tv on tv.id = r.trade_id
      left join dimension_value lv on lv.id = r.location_id
      left join member am on am.id = r.assignee_member_id
      -- RP-644: its Package, one of the importing Participant's own (said by the function, not
      -- RLS: Rabaed Admin reads past it); a Package discarded since reads as none.
      left join app.register_import_packages(${r.project_id}::uuid) k on k.package_id = r.package_id
      order by r.row_no
    `.execute(trx);
    const mapping = registerImportMapping.parse(r.mapping);
    const fieldKeys = (mapping.fields ?? []).map((f) => f.key);
    const imported = rows.map((row) => ({
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
        assignee: { text: row.assignee_text, match: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name! } : null },
        package: {
          text: row.package_text,
          match: row.package_id ? { id: row.package_id, number: packageNumber(row.package_seq!), name: row.package_name!, status: row.package_status! } : null,
          new: row.package_new,
        },
        reasons: row.reasons,
        created: row.created,
        workItemId: row.work_item_id,
    }));
    return {
      ...toSummary(r),
      projectId: r.project_id,
      defaultRaiser: { id: r.raiser_id, name: r.raiser_name },
      sheet: r.sheet,
      headerRow: r.header_row,
      headers: r.headers,
      mapping,
      rows: imported,
      rowsSuggested: imported.filter((row) => row.reasons.length === 0 && rowUsesSuggestion(mapping, row)).length,
      // What confirm does with Packages: a preview's good rows, a confirmed import's created ones.
      packages: packagesOfRows(imported.filter((row) => (r.status === "created" ? row.created : row.reasons.length === 0))),
      original: r.source_file_id !== null && !engineer && importer.files !== undefined,
    };
  });
}

/** The Packages `rows` go to, each once, with how many: an existing one by its id, a new one by its name. */
function packagesOfRows(rows: RegisterImport["rows"]): RegisterImport["packages"] {
  const out = new Map<string, RegisterImport["packages"][number]>();
  for (const row of rows) {
    const { match, new: newName } = row.package;
    const key = match ? `id:${match.id}` : newName ? `new:${newName.toLowerCase()}` : null;
    if (!key) continue;
    const known = out.get(key);
    out.set(key, { package: match, newName, rows: (known?.rows ?? 0) + 1 });
  }
  return [...out.values()];
}

/** Creates the Drafts of the importer's own preview: one per good row, all or nothing. */
export function confirmRegisterImport(importer: RegisterImporter<ConfirmRegisterImportResult>, importId: string, now: Date): Promise<ConfirmRegisterImportResult> {
  return importer.run(async (trx): Promise<ConfirmRegisterImportResult> => {
    const { engineer } = importer;
    const { rows } = await (engineer
      ? engineer.own(trx, (own) =>
          sql<{ outcome: string; rows_created: number | null }>`
            select outcome, rows_created from app.confirm_register_import_by_engineer(${engineer.id}::uuid, ${importId}::uuid, ${now})`.execute(own),
        )
      : sql<{ outcome: string; rows_created: number | null }>`select outcome, rows_created from app.confirm_register_import(${importId}::uuid, ${now})`.execute(trx));
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...confirmRefusals]);
    return outcome === "created" ? { ok: true, rowsCreated: rows[0]!.rows_created! } : { ok: false, reason: outcome };
  });
}

// Saved mappings (RP-644, story 11): a Member saves the mapping under a name for their
// Participant on the Project; its Members apply, rename and delete them. Never with a time.

export type SavedMappingsResult = { ok: true; mappings: RegisterImportMappings } | { ok: false; reason: "not_found" | "name_taken" };

/** The importer's Participant's saved mappings on the Project, by name, as Map fields offers them. */
const savedMappings = async (trx: Trx, projectId: string): Promise<RegisterImportMappings> => ({ mappings: await savedMappingsOf(trx, projectId) });

/** Saves `request.mapping` under its name for the Member's Participant on the Project. */
export function saveRegisterImportMapping(db: Db, memberId: string, projectId: string, request: SaveRegisterImportMappingRequest, now: Date): Promise<SavedMappingsResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select outcome from app.save_register_import_mapping(${projectId}::uuid, ${request.name}, ${JSON.stringify(request.mapping)}::jsonb, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["saved", "not_found", "name_taken"]);
    return outcome === "saved" ? { ok: true, mappings: await savedMappings(trx, projectId) } : { ok: false, reason: outcome };
  });
}

/** Renames (with `name`) or deletes a saved mapping of the Member's Participant; answers its Participant's saved mappings. */
export function changeRegisterImportMapping(db: Db, memberId: string, mappingId: string, change: { name: string } | "delete"): Promise<SavedMappingsResult> {
  return withMember(db, memberId, async (trx) => {
    // Its Project, where the Member reads it (the table's policy; Members only, never Rabaed Admin).
    const mine = await trx.selectFrom("register_import_mapping").select("project_id").where("id", "=", mappingId).executeTakeFirst();
    if (!mine) return { ok: false, reason: "not_found" } as const;
    const { rows } = await (
      change === "delete"
        ? sql<{ outcome: string }>`select app.delete_register_import_mapping(${mappingId}::uuid) as outcome`
        : sql<{ outcome: string }>`select app.rename_register_import_mapping(${mappingId}::uuid, ${change.name}) as outcome`
    ).execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["removed", "renamed", "not_found", "name_taken"]);
    if (outcome === "not_found" || outcome === "name_taken") return { ok: false, reason: outcome } as const;
    return { ok: true, mappings: await savedMappings(trx, mine.project_id) } as const;
  });
}
