// The UAT tool's database side (RP-922): what `scripts/uat-age.ts` and `scripts/uat-run-job.ts` run.
// Dev and UAT only: not a migration, not exported from @rabaed/db's src/index.ts, and nothing
// under apps/*/src or packages/*/src imports it (scripts/uat-imports.test.ts). The aging runs as
// the migrator, never as rabaed_app, and grant it nothing.
import { sql } from "kysely";
import type { Db } from "../src/client.ts";

export { ageChanges, type AgeChanges, type AgedItem } from "./changes.ts";
export { JOBS, runJob, type JobName, type JobRow, type JobRun, type RunJobOptions } from "./jobs.ts";
export { AgeRefused, ageItems, ITEM_TIME_MAPS, ITEM_TIMES, type AgedRows, type AgeItem, type TableTimes } from "./age.ts";

/** An item that may be what an `--item` named: its Document Number or Subject comes close. */
export interface AgeCandidate {
  id: string;
  /** Null for a Draft. */
  documentNumber: string | null;
  subject: string;
  closed: boolean;
  /** When it reached its current Step: its own Company's Step Age (ADR 0020). */
  stepEnteredAt: Date;
  /** When it reached its current Participant: other Companies' Step Age (app.step_as_seen). */
  participantEnteredAt: Date;
}

/** `text` as a LIKE pattern for "contains", its own `%`, `_` and `\` taken literally. */
const containing = (text: string) => `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The items whose Document Number or Subject contains one of `texts` (any case), for uat:age to choose among. As the migrator. */
export async function findAgeCandidates(db: Db, texts: string[]): Promise<AgeCandidate[]> {
  const { rows } = await sql<{ id: string; document_number: string | null; title: string; closed: boolean; step_entered_at: Date; participant_entered_at: Date }>`
    select id, document_number, title, closed_at is not null or discarded_at is not null as closed, step_entered_at, participant_entered_at
    from work_item w
    where exists (select 1 from unnest(${texts.map(containing)}::text[]) p where w.document_number ilike p or w.title ilike p)
    order by w.document_number nulls last, w.title, w.id
    limit 500`.execute(db);
  return rows.map((r) => ({
    id: r.id,
    documentNumber: r.document_number,
    subject: r.title,
    closed: r.closed,
    stepEnteredAt: r.step_entered_at,
    participantEnteredAt: r.participant_entered_at,
  }));
}
