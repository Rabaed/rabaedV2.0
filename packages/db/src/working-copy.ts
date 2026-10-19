import type { BilingualText, RecordLanguage } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { CompanyFact, DocumentFact, FormFacts, OutcomeFact } from "./documental-record.ts";
import type { Database } from "./schema.ts";

// The Working Copy's reads and writes (RP-621; migration …_working_copy.sql; visibility.md, the
// Working Copy row). A Member asks for it through the api (app.request_working_copy); the worker
// prints it (apps/worker/src/record/working-copy.ts) and keeps where it is.

/** A shared move: by its Company only, never a person (V14). */
export interface MoveFact {
  /** The Transition's kind (`send`, `submit`, `return`, `send_back`, `close`, `cancel`). */
  readonly kind: string;
  readonly label: BilingualText;
  /** When it was taken (ISO 8601, UTC). */
  readonly at: string;
  readonly participantId: string;
  readonly companyName: BilingualText;
  /** The Project Role of the Company on the Project. */
  readonly roleName: BilingualText;
}

/** What a Working Copy prints (app.working_copy_content): the item as shared, the same for every viewer. */
export interface WorkingCopyContent {
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectName: BilingualText;
  readonly recordLanguage: RecordLanguage;
  readonly hijriDates: boolean;
  /** The Project's watermark text, printed across every page. */
  readonly watermark: BilingualText;
  readonly type: { readonly code: string; readonly name: BilingualText };
  readonly documentNumber: string | null;
  readonly revisionNo: number;
  readonly revisionOf: { readonly documentNumber: string; readonly closedAt: string; readonly outcome: string } | null;
  readonly subject: string;
  /** The Submission Date (ISO 8601, UTC); null for a Draft. */
  readonly submittedAt: string | null;
  /** The Stage every Company but the holder reads (a Draft's own). */
  readonly stage: BilingualText | null;
  readonly outcomes: readonly OutcomeFact[];
  readonly companies: readonly CompanyFact[];
  readonly trades: readonly { readonly name: BilingualText; readonly selected: boolean }[];
  readonly location: readonly BilingualText[] | null;
  readonly scopes: readonly BilingualText[];
  readonly form: FormFacts;
  readonly documents: readonly DocumentFact[];
  readonly moves: readonly MoveFact[];
}

/** What Working Copy job `outboxId` prints, or null when there is nothing to make (made already, or its content changed since). */
export async function workingCopyJob(
  trx: Transaction<Database>,
  outboxId: string,
): Promise<{ workingCopyId: string; content: WorkingCopyContent } | null> {
  const { rows } = await sql<{ job: { workingCopyId: string; content: WorkingCopyContent } | null }>`
    select app.working_copy_job(${outboxId}::uuid) as job
  `.execute(trx);
  return rows[0]?.job ?? null;
}

/** Keeps where job `outboxId`'s PDF is; false when it was made already or went stale. */
export async function saveWorkingCopy(trx: Transaction<Database>, outboxId: string, storageKey: string): Promise<boolean> {
  const { rows } = await sql<{ saved: boolean }>`select app.save_working_copy(${outboxId}::uuid, ${storageKey}) as saved`.execute(trx);
  return rows[0]?.saved ?? false;
}
