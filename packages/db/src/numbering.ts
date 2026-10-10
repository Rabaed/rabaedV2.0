import type { StoredNumberingCounter, StoredNumberingPattern, StoredNumberingVersion } from "@rabaed/domain";
import { sql } from "kysely";
import type { Db } from "./client.ts";

type BilingualJson = { en: string; ar: string };

// The numbering reads the api (a Project's Members, through the app role and its
// row-level security) and Rabaed Admin (rabaed_admin) both make, in one place
// (RP-311 review). They return rows as stored; @rabaed/domain maps them
// (toSavedNumberingPattern, numberingPatternsInEffect, toNumberingCounter,
// counterWorkItemTypes).

/** The patterns of a Project in effect at `at`: the newest of each scope (the Project's, and each Type's). */
export async function readNumberingPatterns(db: Db, projectId: string, at: Date): Promise<StoredNumberingPattern[]> {
  const { rows } = await sql<StoredNumberingPattern>`
    select distinct on (work_item_type_id)
      work_item_type_id, follows_project, segments, separator, seq_digits, seq_scope, effective_from, shared_counter_accepted_at
    from numbering_pattern
    where project_id = ${projectId}::uuid and effective_from <= greatest(${at}::timestamptz, now())
    order by work_item_type_id, effective_from desc, id desc
  `.execute(db);
  return rows;
}

/**
 * Every version of a Project's patterns at `at`, newest first per scope, with who
 * saved each as the calling Member may know it (app.numbering_pattern_versions:
 * the Company per V15, the person within their own Company only, V14). Empty for
 * anyone outside the Project.
 */
export async function readNumberingVersions(db: Db, projectId: string, at: Date): Promise<StoredNumberingVersion[]> {
  const { rows } = await sql<StoredNumberingVersion>`
    select work_item_type_id, version_no, effective_from, follows_project, segments, separator, seq_digits, seq_scope,
      by_rabaed, company_name, member_name
    from app.numbering_pattern_versions(${projectId}::uuid, ${at}::timestamptz)
  `.execute(db);
  return rows;
}

/**
 * The Work Item Types a Project can use: the Rabaed Default Types and the Project's
 * own, by code, a Project's own before a Rabaed Default of the same code.
 */
export async function readNumberingWorkItemTypes(db: Db, projectId: string): Promise<{ id: string; code: string; name: BilingualJson }[]> {
  const { rows } = await sql<{ id: string; code: string; name: BilingualJson }>`
    select id, code, name from work_item_type where project_id is null or project_id = ${projectId}::uuid
    order by code, project_id nulls last, id
  `.execute(db);
  return rows;
}

/** A Project's counters, by key. */
export async function readNumberingCounters(db: Db, projectId: string): Promise<StoredNumberingCounter[]> {
  const { rows } = await sql<StoredNumberingCounter>`
    select counter_key, last_value, starting_value from numbering_counter where project_id = ${projectId}::uuid order by counter_key
  `.execute(db);
  return rows;
}
