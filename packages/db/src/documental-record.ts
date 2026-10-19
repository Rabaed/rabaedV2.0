import type { BilingualText, FormPdf, OutcomeAction, RecordLanguage } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.ts";

// The Documental Record's reads and writes for the worker's record job
// (RP-620; migration 20270617000000_documental_record.sql; workflow-engine.md
// §7). The job itself, which makes and seals the PDF, is the worker's
// (apps/worker/src/record). Both run as the app role with no Member set.

/** One Transition taken on the item, in order: Returns and the work around them included. */
export interface TransitionFact {
  /** The Transition's kind (`send`, `submit`, `return`, `send_back`, `close`, `cancel`). */
  readonly kind: string;
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly label: BilingualText;
  /** When it was taken (ISO 8601, UTC). */
  readonly at: string;
  /** The Member's name, Positions and Company as they were when the Transition was taken. */
  readonly memberName: BilingualText;
  /** The Member's Positions on the Project then, in their order. */
  readonly positions: readonly BilingualText[];
  readonly companyName: BilingualText;
  /** The item's content hash as the Transition left it (hex), when it has one. */
  readonly contentSha256: string | null;
  /** The Transition's outcome mode (`issue_code` and `confirm_code` give a Code), null for the others. */
  readonly outcomeMode: string | null;
  /** The Remarks of a Code's own shared event; null for any other Transition, and never a Recommended Code's. */
  readonly remarks: string | null;
  readonly participantId: string;
  /** The Project Role of the Member's Company on the Project. */
  readonly roleName: BilingualText;
  /**
   * What the Member wrote in the Transition's Action Form, when its event is shared (RP-650): the
   * answers of its shared fields, never an `internal_answers` event's, an Internal Note or a
   * Recommended Code. Null for a move inside one Participant, or one of the Owner's review's.
   */
  readonly answers: Readonly<Record<string, unknown>> | null;
  /** The Transition's Action Form as its Workflow Version pinned it (`{sections}`), to label the answers. */
  readonly actionForm: unknown;
  /** The Signature the event recorded (`work_item_event.signature_id`): the one in force when the Member acted. */
  readonly signature: ImageFact | null;
}

/** An image Rabaed keeps (stored_file): where it is and its type. */
export interface ImageFact {
  readonly storageKey: string;
  readonly contentType: string;
}

/** A Comment the issued Code raised (Code B's Comments, RP-434), with who raised it as they were then. */
export interface CommentFact {
  readonly documentNumber: string | null;
  readonly comment: string;
  readonly reference: string | null;
  /** When it was raised (ISO 8601, UTC): when the item closed. */
  readonly at: string;
  readonly memberName: BilingualText;
  readonly positions: readonly BilingualText[];
  readonly companyName: BilingualText;
  readonly roleName: BilingualText;
  readonly participantId: string;
}

export type BaseRoleFact = "owner" | "owner_representative" | "consultant" | "contractor";

/** A Company on the item (or the Owner), with its Project Role. */
export interface CompanyFact {
  readonly participantId: string;
  readonly name: BilingualText;
  readonly roleName: BilingualText;
  readonly baseRole: BaseRoleFact;
  /** Its logo and Stamp in force when the item closed (RP-650); null without one. */
  readonly logo: ImageFact | null;
  readonly stamp: ImageFact | null;
}

/** One of the Type's closing outcomes, for the chips of the Final decision box. */
export interface OutcomeFact {
  readonly code: string;
  readonly name: BilingualText;
  readonly polarity: "positive" | "negative";
  readonly actions: OutcomeAction[];
}

/**
 * A Document the other Participants saw (RP-147): confirmed, never removed, on a Submitted item and
 * added before the arrival the close follows, so never one only its holder saw.
 */
export interface DocumentFact {
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly storageKey: string;
  /** Its bytes' SHA-256 (hex), taken when its upload was confirmed (RP-618); null only before RP-618. */
  readonly sha256: string | null;
  /** The Form's `attachments`, `photos` or `checklist` field it belongs to; null for the Attachments System Field. */
  readonly fieldKey: string | null;
  readonly itemKey: string | null;
  /** When an image was taken (ISO 8601, UTC), from its EXIF. */
  readonly takenAt: string | null;
}

/** An option of an Option List the Form uses (nested by the worker, buildOptionLists). */
export interface OptionFact {
  readonly id: string;
  readonly optionListId: string;
  readonly parentId: string | null;
  readonly value: string;
  readonly label: BilingualText;
  readonly retired: boolean;
}

/** The Form the item was made with: its sections, the answers as every reader reads them, and what names their ids. */
export interface FormFacts {
  /** The Form Version's sections, as published (form-engine.md §1). */
  readonly sections: unknown;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly optionLists: readonly { readonly id: string; readonly name: BilingualText }[];
  readonly options: readonly OptionFact[];
  readonly suppliers: readonly { readonly id: string; readonly name: BilingualText }[];
  /** Company names by Participant id, for the `participant` answers. */
  readonly companyNames: Readonly<Record<string, BilingualText>>;
}

/** What the record job is told about a closed item (app.documental_record_facts). */
export interface RecordFacts {
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectName: BilingualText;
  readonly type: { readonly code: string; readonly name: BilingualText };
  readonly documentNumber: string | null;
  readonly revisionNo: number;
  readonly subject: string;
  readonly outcome: string;
  /** When it closed (ISO 8601, UTC). */
  readonly closedAt: string;
  /** The Project's record language and whether Hijri dates show beside the Gregorian ones, as set when the record is made. */
  readonly recordLanguage: RecordLanguage;
  readonly hijriDates: boolean;
  /** The Revision's source: the item it revises and when that one closed. */
  readonly revisionOf: { readonly documentNumber: string; readonly closedAt: string; readonly outcome: string } | null;
  /** The Submission Date (ISO 8601, UTC). */
  readonly submittedAt: string | null;
  readonly outcomes: readonly OutcomeFact[];
  readonly companies: readonly CompanyFact[];
  /** The Project's Trades, the item's marked. */
  readonly trades: readonly { readonly name: BilingualText; readonly selected: boolean }[];
  /** The Location from its first level down. */
  readonly location: readonly BilingualText[] | null;
  readonly scopes: readonly BilingualText[];
  readonly reviewComments: number;
  readonly form: FormFacts;
  readonly documents: readonly DocumentFact[];
  readonly transitions: readonly TransitionFact[];
  /** The raiser's Participant: a Code C's Revision is theirs to make. */
  readonly raiserParticipantId: string;
  /** The Comments the issued Code raised, in the order its reply listed them (RP-650). */
  readonly comments: readonly CommentFact[];
  /** The Form Version's `pdf` block: its Disclaimer and whether the review duration shows. */
  readonly pdf: FormPdf | null;
  /** When Rabaed cancelled the item because a Company left the Project: that Company. */
  readonly cancelledByRabaed: { readonly companyName: BilingualText } | null;
}

/** The closed item of record job `outboxId`, or null when there is nothing to make (it has its record already). */
export async function documentalRecordFacts(trx: Transaction<Database>, outboxId: string): Promise<RecordFacts | null> {
  const { rows } = await sql<{ facts: RecordFacts | null }>`select app.documental_record_facts(${outboxId}::uuid) as facts`.execute(trx);
  return rows[0]?.facts ?? null;
}

/** A stored file of the record: where, its SHA-256 and its size. */
export interface RecordFile {
  readonly storageKey: string;
  readonly sha256: Uint8Array;
  readonly size: number;
}

export interface SealedRecord {
  readonly pdf: RecordFile;
  readonly recordData: RecordFile;
  readonly layoutVersion: string;
  readonly language: RecordLanguage;
  readonly sealedAt: Date;
  /** The SHA-256 of the verification page's long link. */
  readonly verificationTokenHash: Uint8Array;
  readonly verificationCode: string;
}

/** Saves the sealed record of job `outboxId`; false when the item has one already. */
export async function saveDocumentalRecord(trx: Transaction<Database>, outboxId: string, record: SealedRecord): Promise<boolean> {
  const { rows } = await sql<{ saved: boolean }>`
    select app.save_documental_record(
      ${outboxId}::uuid,
      ${record.pdf.storageKey}, ${Buffer.from(record.pdf.sha256)}, ${record.pdf.size},
      ${record.recordData.storageKey}, ${Buffer.from(record.recordData.sha256)}, ${record.recordData.size},
      ${record.layoutVersion}, ${record.language}, ${record.sealedAt},
      ${Buffer.from(record.verificationTokenHash)}, ${record.verificationCode}
    ) as saved
  `.execute(trx);
  return rows[0]?.saved ?? false;
}
