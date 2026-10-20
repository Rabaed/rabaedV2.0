import { saveSnagReport, snagReportJob, type OutboxHandler } from "@rabaed/db";
import { inlinePhotos } from "../record/assets.ts";
import type { RecordFiles } from "../record/files.ts";
import type { RecordFonts } from "../record/fonts.ts";
import { sha256 } from "../record/pki.ts";
import type { PdfRenderer } from "../record/render.ts";
import { snagReportHtml } from "./layout.ts";

// The Snag report job (RP-677; ADR 0023): the outbox handler for kind 'snag_report', queued when a Member
// asks for a report. It prints the snapshot the api read as that Member (so only what they saw), with the
// photos they were allowed to see, through the Documental Record's own Chromium renderer, and stores the
// plain PDF under the Project's `snag-reports/` prefix. A failure throws, so the outbox retries the row and
// then dead-letters it (the report then shows as failed); until the save nothing is issued.

export interface SnagReportJobDeps {
  readonly files: RecordFiles;
  readonly renderer: PdfRenderer;
  /** The fonts, read once (the record's). */
  readonly fonts: () => Promise<RecordFonts>;
  readonly now?: () => Date;
}

/** Where a report lives, under its Project (the worker may write only here and under the records). */
export function snagReportKey(projectId: string, reportId: string): string {
  return `projects/${projectId}/snag-reports/${reportId}/snag-report.pdf`;
}

export function snagReportHandler(deps: SnagReportJobDeps): OutboxHandler {
  const now = deps.now ?? (() => new Date());
  return async (trx, row) => {
    const job = await snagReportJob(trx, row.id);
    if (!job) return;
    const { images } = await inlinePhotos(
      job.content.items.flatMap((i) => (i.photo ? [i.photo] : [])),
      deps.files,
    );
    const pdf = await deps.renderer.render(snagReportHtml(job.content, job.language, await deps.fonts(), images, now()));
    const storageKey = snagReportKey(job.projectId, job.reportId);
    await deps.files.put(storageKey, pdf, "application/pdf");
    await saveSnagReport(trx, row.id, { storageKey, sha256: await sha256(pdf), size: pdf.length });
  };
}
