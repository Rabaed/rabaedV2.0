import { z } from "zod";
import { bilingualText } from "./company.ts";
import { snagBulkMax } from "./snag-bulk.ts";

// The Snag report (RP-677, spec RP-619): a plain PDF of the Snag List items the viewer sees, made by the
// worker with the Documental Record's headless-Chromium pipeline (ADR 0023). It is not a Documental Record:
// not PDF/A-3, not sealed. The api reads the items as the viewer, when they ask, into `snagReportContent`;
// the worker prints that and nothing else, so a report holds exactly what the viewer saw (V3, V14). Step Age
// only, never a due date or "overdue".

/** The most items one report holds (the List's Export cap, `workItemExportMax`, applies first). */
export const snagReportMax = 500;

/** The report's language: one, as the viewer reads (RTL for Arabic). */
export const snagReportLanguage = z.enum(["en", "ar"]);
export type SnagReportLanguage = z.infer<typeof snagReportLanguage>;

/** Which items: the chosen ones, or (left out) every item the List's filters match. */
export const snagReportRequest = z.object({ ids: z.array(z.uuid()).min(1).max(snagBulkMax).optional(), language: snagReportLanguage });
export type SnagReportRequest = z.infer<typeof snagReportRequest>;

/** One item as the viewer read it. */
export const snagReportItem = z.object({
  documentNumber: z.string().nullable(),
  subject: z.string(),
  type: bilingualText,
  trade: bilingualText,
  location: bilingualText.nullable(),
  stage: bilingualText,
  /** Who it is with, as the viewer reads it (V14): their own person, else the Company by name only. */
  with: bilingualText.nullable(),
  /** Weeks at the current Step; null for a closed item and a Draft with no number yet. */
  stepAgeWeeks: z.number().int().positive().nullable(),
  /** The first photo the viewer sees (RLS on Documents), where the worker reads it. */
  photo: z.object({ storageKey: z.string(), contentType: z.string(), size: z.number().int().nonnegative() }).nullable(),
});
export type SnagReportItem = z.infer<typeof snagReportItem>;

/** What the worker prints. */
export const snagReportContent = z.object({
  projectName: bilingualText,
  items: z.array(snagReportItem).max(snagReportMax),
  /** More matched than the report holds. */
  capped: z.boolean(),
});
export type SnagReportContent = z.infer<typeof snagReportContent>;

export const snagReportStatuses = ["preparing", "ready", "failed"] as const;

/** The answer to asking for a report, and to asking after it: `url` once it is ready. */
export const snagReportState = z.object({
  id: z.uuid(),
  status: z.enum(snagReportStatuses),
  url: z.url().nullable(),
  /** How many items it holds (known when asked for). */
  count: z.number().int().nonnegative().nullable(),
});
export type SnagReportState = z.infer<typeof snagReportState>;
