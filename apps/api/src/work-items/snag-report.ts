import { requestSnagReport, snagReportState, withMember, type Db } from "@rabaed/db";
import {
  isOpenStageCategory,
  snagReportMax,
  workItemExportMax,
  type SignedUrl,
  type SnagReportContent,
  type SnagReportItem,
  type SnagReportRequest,
  type SnagReportState,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { exportWorkItems } from "./query.ts";

// The Snag report (RP-677, spec RP-619): what the viewer asks the worker to print. The items are read here
// as the viewer, through the Snag List's own Export read (so the filters, the order, V3 and V14 are the
// List's), narrowed to the chosen ids when some were chosen; an id the viewer does not see is simply not
// in the report. Each photo is looked up through row-level security on Documents as the viewer. The worker
// prints this snapshot and reads nothing else about the items.

/** The one name a row's holder shows as the viewer reads it (V14): their own person, else the Company only. */
function withOf(row: WorkItemRow): SnagReportItem["with"] {
  if (!row.with) return null;
  return row.with.kind === "own" ? (row.with.holder?.name ?? row.with.companyName) : row.with.companyName;
}

/** Asks for a report; null when the viewer is not on the Project or the Snag List has nothing they see. */
export async function askForSnagReport(
  db: Db,
  memberId: string,
  projectId: string,
  query: WorkItemQuery,
  request: SnagReportRequest,
  now: Date,
): Promise<SnagReportState | null> {
  const exported = await exportWorkItems(db, memberId, { projectId, moduleKey: "snag_list" }, { ...query, module: "snag_list" }, now, request.ids === undefined ? snagReportMax : workItemExportMax);
  if (!exported) return null;
  const chosen = request.ids === undefined ? undefined : new Set(request.ids);
  const rows = chosen ? exported.items.filter((r) => chosen.has(r.id)) : exported.items;
  if (rows.length === 0) return null;
  // Chosen ids are narrowed from every row the List's filters match (at most the Export's cap), then held to the report's own.
  return withMember(db, memberId, async (trx) => {
    const project = await sql<{ name: { en: string; ar: string } }>`select name from project where id = ${projectId}`.execute(trx);
    if (!project.rows[0]) return null;
    // A photo is read through row-level security on Documents, as the viewer: one they may not see has no row here.
    const photoIds = rows.flatMap((r) => (r.photo ? [r.photo.documentId] : []));
    const photos = new Map<string, NonNullable<SnagReportItem["photo"]>>();
    if (photoIds.length > 0) {
      const found = await sql<{ id: string; storage_key: string; content_type: string; size_bytes: string }>`
        select id, storage_key, content_type, size_bytes from document
        where id = any(${photoIds}::uuid[]) and project_id = ${projectId} and removed_at is null
      `.execute(trx);
      for (const d of found.rows) photos.set(d.id, { storageKey: d.storage_key, contentType: d.content_type, size: Number(d.size_bytes) });
    }
    const content: SnagReportContent = {
      projectName: project.rows[0].name,
      capped: request.ids === undefined && exported.capped,
      items: rows.map((r) => ({
        documentNumber: r.documentNumber,
        subject: r.title,
        type: r.type.name,
        trade: r.trade.name,
        location: r.location?.name ?? null,
        stage: r.stage.name,
        with: withOf(r),
        stepAgeWeeks: isOpenStageCategory(r.stage.category) ? r.stepAgeWeeks : null,
        photo: (r.photo && photos.get(r.photo.documentId)) || null,
      })),
    };
    const id = await requestSnagReport(trx, projectId, request.language, content);
    return id ? { id, status: "preparing", url: null, count: content.items.length } : null;
  });
}

/** Where the viewer's own report is, with its download link once it is made; null for anyone else's and a made-up id. */
export async function snagReportOf(db: Db, files: FileStore, memberId: string, reportId: string, now: Date): Promise<SnagReportState | null> {
  const state = await withMember(db, memberId, (trx) => snagReportState(trx, reportId));
  if (!state) return null;
  let link: SignedUrl | null = null;
  if (state.status === "ready" && state.storageKey) {
    link = await files.signDownload(state.storageKey, { fileName: state.fileName ?? "snag-report.pdf", contentType: "application/pdf" }, now);
  }
  return { id: reportId, status: state.status, url: link?.url ?? null, count: null };
}
