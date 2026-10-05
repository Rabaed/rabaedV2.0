import { withMember, type Db } from "@rabaed/db";
import type { NumberingPattern, NumberingSettings, SavedNumberingPattern, SaveNumberingPatternRequest } from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";

// The Numbering page (RP-313; workflow-engine.md §8 "Settled 2026-10-05 (Document
// numbering)"): every Project Member reads the Project's Numbering Pattern and
// per-Type overrides (numbering_pattern's RLS); only a Project Admin saves one,
// through app.set_numbering_pattern. Anyone else gets 'not_found'.

const saveRefusals = ["not_found", "project_closed", "type_not_found", "invalid_pattern", "shared_counter_not_accepted"] as const;
export type SaveNumberingPatternResult = { ok: true } | { ok: false; reason: (typeof saveRefusals)[number] };

type StoredPattern = {
  work_item_type_id: string | null;
  segments: NumberingPattern["segments"];
  separator: NumberingPattern["separator"];
  seq_digits: number;
  seq_scope: number[];
  effective_from: Date;
  shared_counter_accepted_at: Date | null;
};

const toSaved = (r: StoredPattern): SavedNumberingPattern => ({
  pattern: { segments: r.segments, separator: r.separator, seqDigits: r.seq_digits, countedBy: r.seq_scope },
  effectiveFrom: r.effective_from.toISOString(),
  sharedCounterAcceptedAt: r.shared_counter_accepted_at?.toISOString() ?? null,
});

/** A Project's numbering for the Numbering page, for its Project Members; null for anyone else. */
export function getNumberingSettings(db: Db, memberId: string, projectId: string, now: Date): Promise<NumberingSettings | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows: projects } = await sql<{ code: string; is_admin: boolean; participant_code: string | null; ordinal: number }>`
      select pr.code,
        exists (select 1 from app.current_admin_project_ids() a where a = pr.id) as is_admin,
        -- The reader's own Participant: its Participant Code, or its position until set.
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
    const { rows: patterns } = await sql<StoredPattern>`
      select distinct on (work_item_type_id)
        work_item_type_id, segments, separator, seq_digits, seq_scope, effective_from, shared_counter_accepted_at
      from numbering_pattern
      where project_id = ${projectId}::uuid and effective_from <= greatest(${now}::timestamptz, now())
      order by work_item_type_id, effective_from desc, id desc
    `.execute(trx);
    const { rows: types } = await sql<{ id: string; code: string; name: { en: string; ar: string } }>`
      select id, code, name from work_item_type
      where project_id is null or project_id = ${projectId}::uuid
      order by code, id
    `.execute(trx);
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

    const projectPattern = patterns.find((p) => p.work_item_type_id === null);
    return {
      canEdit: project.is_admin,
      project: projectPattern ? toSaved(projectPattern) : null,
      types: types.map((t) => {
        const override = patterns.find((p) => p.work_item_type_id === t.id);
        return { id: t.id, code: t.code, name: t.name, override: override ? toSaved(override) : null };
      }),
      example: {
        projectCode: project.code,
        tradeCode: trades[0]?.code ?? null,
        participant: { code: project.participant_code, ordinal: project.ordinal },
        locationPath: locations.map((l) => l.code),
      },
    };
  });
}

/** A Project Admin saves the Project's Numbering Pattern, or a Work Item Type's override, in effect from now. */
export function saveNumberingPattern(
  db: Db,
  memberId: string,
  projectId: string,
  input: SaveNumberingPatternRequest,
  now: Date,
): Promise<SaveNumberingPatternResult> {
  return withMember(db, memberId, async (trx) => {
    const { pattern } = input;
    const { rows } = await sql<{ outcome: string }>`
      select app.set_numbering_pattern(
        ${projectId}::uuid, ${input.workItemTypeId}::uuid, ${JSON.stringify(pattern.segments)}::jsonb, ${pattern.separator},
        ${pattern.seqDigits}::integer, ${JSON.stringify(pattern.countedBy)}::jsonb, ${input.sharedCounterAccepted}, ${now}
      ) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "saved", saveRefusals);
  });
}
