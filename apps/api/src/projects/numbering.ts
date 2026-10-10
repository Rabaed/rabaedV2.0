import { readNumberingPatterns, readNumberingVersions, readNumberingWorkItemTypes, withMember, type Db } from "@rabaed/db";
import {
  numberingPatternRefusals,
  numberingPatternsInEffect,
  type NumberingSettings,
  toNumberingVersion,
  type SaveNumberingRequest,
} from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";
import { isProjectAdmin } from "./project-admin.ts";

// The Numbering page (RP-313; workflow-engine.md §8 "Settled 2026-10-05 (Document
// numbering)"): every Project Member reads the Project's Numbering Pattern and
// per-Type overrides (numbering_pattern's RLS); only a Project Admin saves one,
// through app.set_numbering_pattern. Anyone else gets 'not_found'.

export type SaveNumberingPatternResult = { ok: true } | { ok: false; reason: (typeof numberingPatternRefusals)[number] };

/** A Project's numbering for the Numbering page, for its Project Members; null for anyone else. */
export function getNumberingSettings(db: Db, memberId: string, projectId: string, now: Date): Promise<NumberingSettings | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows: projects } = await sql<{ code: string; participant_code: string | null; ordinal: number }>`
      select pr.code,
        -- The reader's own Participant: its Participant Code, and its position for a Project Admin only.
        p.code as participant_code, p.ordinal
      from project pr
      join project_member pm on pm.project_id = pr.id and pm.member_id = app.current_member_id() and pm.status = 'active'
      join participant p on p.id = pm.participant_id
      where pr.id = ${projectId}::uuid and pr.id in (select app.current_project_ids())
      limit 1
    `.execute(trx);
    const project = projects[0];
    if (!project) return null;

    // The pattern in effect now, per Type and for the Project (the newest row of each).
    const patterns = await readNumberingPatterns(trx, projectId, now);
    const types = await readNumberingWorkItemTypes(trx, projectId);
    const versions = await readNumberingVersions(trx, projectId, now);
    // The live example's Trade and Location: the Project's first ones, the Location from its Zone down.
    const { rows: trades } = await sql<{ code: string }>`
      select v.code from dimension_value v join visibility_dimension d on d.id = v.dimension_id
      where v.project_id = ${projectId}::uuid and d.kind = 'trade'
      order by v.sort, v.id limit 1
    `.execute(trx);
    const { rows: locations } = await sql<{ code: string }>`
      with recursive first_down as (
        (select v.id, v.code, v.depth from dimension_value v join visibility_dimension d on d.id = v.dimension_id
         where v.project_id = ${projectId}::uuid and d.kind = 'location' and v.parent_id is null
         order by v.sort, v.id limit 1)
        union all
        (select c.id, c.code, c.depth from dimension_value c join first_down f on c.parent_id = f.id
         order by c.sort, c.id limit 1)
      )
      select code from first_down order by depth
    `.execute(trx);

    const canEdit = await isProjectAdmin(trx, projectId);
    return {
      canEdit,
      ...numberingPatternsInEffect(patterns, types),
      example: {
        projectCode: project.code,
        tradeCode: trades[0]?.code ?? null,
        // Orders are given out max+1, so even the reader's own would count the other
        // Participants: Project Admins only (visibility.md RP-381-1).
        participant: { code: project.participant_code, ordinal: canEdit ? project.ordinal : null },
        locationPath: locations.map((l) => l.code),
      },
      versions: versions.map(toNumberingVersion),
    };
  });
}

/** A Project Admin saves the Project's Numbering Pattern, or a Work Item Type's override, in effect from now. */
export function saveNumberingPattern(
  db: Db,
  memberId: string,
  projectId: string,
  input: SaveNumberingRequest,
  now: Date,
): Promise<SaveNumberingPatternResult> {
  return withMember(db, memberId, async (trx) => {
    const { pattern } = input;
    // A null pattern: the Type uses the Project pattern again (refused for the Project's own).
    const json = (value: unknown) => (pattern === null ? null : JSON.stringify(value));
    const { rows } = await sql<{ outcome: string }>`
      select app.set_numbering_pattern(
        ${projectId}::uuid, ${input.workItemTypeId}::uuid, ${json(pattern?.segments)}::jsonb, ${pattern?.separator ?? null},
        ${pattern?.seqDigits ?? null}::integer, ${json(pattern?.countedBy)}::jsonb, ${input.sharedCounterAccepted}, ${now}
      ) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "saved", numberingPatternRefusals);
  });
}
