// The UAT tool's database side (RP-922): what `scripts/uat-age.ts` and `scripts/uat-run-job.ts` run.
// Dev and UAT only: not a migration, not exported from @rabaed/db's src/index.ts, and nothing
// under apps/*/src or packages/*/src imports it (scripts/uat-imports.test.ts). The aging runs as
// the migrator, never as rabaed_app; the jobs run as rabaed_app with no Member set, as the worker.

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
