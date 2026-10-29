// Where the Project files bucket keeps what only the worker writes, and what
// the api stores, by key prefix (ADR 0007). Defined once, so the worker that writes these keys
// (apps/worker record/files.ts, snag-report/job.ts) and the infrastructure that
// refuses the api any write under them (packages/infra app stack, RP-1084)
// agree: a renamed prefix moves both. No imports: the infrastructure loads this
// file on its own.

/** Project files live under this prefix, then the Project's `project_id` (ADR 0007). */
export const PROJECT_FILES_PREFIX = "projects/";

/** An item's Documental Record folder: its sealed PDF, Record Data, replaced PDFs and Working Copies (ADR 0023). */
export function documentalRecordPrefix(projectId: string, workItemId: string): string {
  return `${PROJECT_FILES_PREFIX}${projectId}/work-items/${workItemId}/documental-record/`;
}

/** A Project's Snag reports folder: plain PDFs (RP-677). */
export function snagReportPrefix(projectId: string): string {
  return `${PROJECT_FILES_PREFIX}${projectId}/snag-reports/`;
}

/** Every file in any item's Documental Record folder, as an IAM key pattern. */
export const RECORD_OBJECTS = `${documentalRecordPrefix("*", "*")}*`;

/** Every Snag report in any Project, as an IAM key pattern. */
export const SNAG_REPORT_OBJECTS = `${snagReportPrefix("*")}*`;

// What the api stores under projects/, built in SQL; packages/db/test/storage-keys-sql.test.ts
// checks those builders stay inside these patterns, which the infrastructure grants (RP-1104).

/** Every Document of any item, as an IAM key pattern: the keys `app.document_storage_key` builds. */
export const DOCUMENT_OBJECTS = `${PROJECT_FILES_PREFIX}*/work-items/*/documents/*`;

/** Every register import file, as an IAM key pattern: the keys `app.register_import_file_key` builds. */
export const REGISTER_IMPORT_OBJECTS = `${PROJECT_FILES_PREFIX}*/register-imports/*`;
