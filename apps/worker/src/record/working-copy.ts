import { saveWorkingCopy, workingCopyJob, type MoveFact, type OutboxHandler, type WorkingCopyContent } from "@rabaed/db";
import { documentAssets } from "./assets.ts";
import type { RecordFiles } from "./files.ts";
import { workingCopyKey } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { formContent, isListedDocument } from "./form-content.ts";
import { recordHtml } from "./layout.ts";
import type { Chip, CompanyLine, FlowMark, RecordData } from "./record-data.ts";
import { pick, type RecordLanguage, type RecordText } from "./record-text.ts";
import type { PdfRenderer } from "./render.ts";

// The Working Copy (RP-621; ADR 0023; form-engine.md §6; visibility.md, the Working Copy row):
// an item that isn't closed, printed on request in the record's one layout from the item as
// shared (app.working_copy_content), so it is the same PDF for every viewer. It names Companies
// only: no person, no Signature, no Stamp, no Verification Code, no QR. It is not sealed and not
// archival; the Project's watermark runs across every page. The worker prints it once for each
// content, and the api hands every viewer that one file.

/** A shared move in the approval flow: by its Company only. */
export interface WorkingCopyMove {
  readonly label: RecordText;
  readonly company: RecordText;
  readonly role: RecordText;
  /** When it was taken (ISO 8601, UTC). */
  readonly at: string;
  readonly mark: FlowMark;
}

/** What a Working Copy prints: the record's page 1 and Form, without what only the sealed record carries. */
export interface WorkingCopyData
  extends Pick<
    RecordData,
    | "language"
    | "hijri"
    | "projectName"
    | "type"
    | "documentNumber"
    | "revisionNo"
    | "revisionOf"
    | "subject"
    | "submittedAt"
    | "chips"
    | "companies"
    | "parties"
    | "trades"
    | "location"
    | "scopes"
    | "classification"
    | "sections"
    | "documents"
  > {
  /** The text across every page. */
  readonly watermark: RecordText;
  /** The Stage the item is at, as every Company but its holder reads it. */
  readonly stage: RecordText | null;
  readonly moves: readonly WorkingCopyMove[];
}

/** A move that gives the item back: marked as returned for revision. */
const GIVES_BACK = new Set(["return", "send_back"]);

export function workingCopyDataOf(content: WorkingCopyContent, pageCounts: ReadonlyMap<string, number | null> = new Map()): WorkingCopyData {
  const language: RecordLanguage = content.recordLanguage;
  const { sections, classification, attachmentFieldKeys } = formContent(content, language);
  const company = (c: WorkingCopyContent["companies"][number]): CompanyLine => ({ name: pick(c.name, language), role: pick(c.roleName, language) });
  const move = (m: MoveFact): WorkingCopyMove => ({
    label: pick(m.label, language),
    company: pick(m.companyName, language),
    role: pick(m.roleName, language),
    at: m.at,
    mark: GIVES_BACK.has(m.kind) ? "revise" : "done",
  });
  const chips: Chip[] = content.outcomes.map((o) => ({ code: o.code, name: pick(o.name, language), issued: false }));
  const companies = content.companies.map(company);
  return {
    language,
    hijri: content.hijriDates,
    watermark: pick(content.watermark, language),
    projectName: pick(content.projectName, language),
    type: { code: content.type.code, name: pick(content.type.name, language) },
    documentNumber: content.documentNumber,
    revisionNo: content.revisionNo,
    revisionOf: content.revisionOf,
    subject: content.subject,
    submittedAt: content.submittedAt,
    stage: content.stage ? pick(content.stage, language) : null,
    chips,
    companies,
    parties: companies,
    trades: content.trades.map((t) => ({ name: pick(t.name, language), selected: t.selected })),
    location: (content.location ?? []).map((l) => pick(l, language)),
    scopes: content.scopes.map((s) => pick(s, language)),
    classification,
    moves: content.moves.map(move),
    sections,
    documents: content.documents
      .filter((d) => isListedDocument(d, attachmentFieldKeys))
      .map((d) => ({ fileName: d.fileName, pages: pageCounts.get(d.storageKey) ?? null })),
  };
}

export interface WorkingCopyJobDeps {
  readonly files: RecordFiles;
  readonly renderer: PdfRenderer;
  /** The fonts, read once (fonts.ts). */
  readonly fonts: () => Promise<RecordFonts>;
}

/**
 * The outbox handler for kind 'working_copy': prints the content the Member asked for and keeps
 * where its PDF is. When the content changed since it was asked for, nothing is made (the next
 * request asks again). A failure throws, so the outbox retries it.
 */
export function workingCopyHandler(deps: WorkingCopyJobDeps): OutboxHandler {
  return async (trx, row) => {
    const job = await workingCopyJob(trx, row.id);
    if (!job) return;
    const { content } = job;
    const assets = await documentAssets(content, deps.files);
    const pdf = await deps.renderer.render(recordHtml(workingCopyDataOf(content, assets.pageCounts), await deps.fonts(), assets.images));
    const key = workingCopyKey(content.projectId, content.workItemId, job.workingCopyId);
    await deps.files.put(key, pdf, "application/pdf");
    await saveWorkingCopy(trx, row.id, key);
  };
}
