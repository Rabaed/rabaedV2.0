import { withMember, type Database, type Db } from "@rabaed/db";
import {
  dimensionKinds,
  type BilingualText,
  type DimensionKind,
  type DimensionValues,
  type MemberVisibility,
  type ParticipantVisibility,
  type SetVisibilityRequest,
  type Visibility,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { refusedAsForbidden } from "../db-error.ts";

// Trades, Locations and Visibility grants. Writes go through the app.* functions
// of the visibility migration; reads go through RLS or those functions.

type Forbidden = { ok: false; reason: "forbidden" };
type Trx = Transaction<Database>;

export type AddValueResult =
  | { ok: true; id: string }
  | Forbidden
  | { ok: false; reason: "not_found" | "project_closed" | "parent_not_found" | "too_deep" | "duplicate_code" };

export type SetVisibilityResult =
  | { ok: true }
  | Forbidden
  | {
      ok: false;
      reason: "not_found" | "project_closed" | "member_not_found" | "value_not_found" | "exceeds_participant";
    };

type ValueRow = {
  kind: DimensionKind;
  id: string;
  parent_id: string | null;
  depth: number;
  code: string;
  name: BilingualText;
  level_name: BilingualText | null;
};

function toValues(rows: ValueRow[]): DimensionValues {
  const values: DimensionValues = { trade: [], location: [] };
  for (const r of rows) {
    values[r.kind]?.push({
      id: r.id,
      parentId: r.parent_id,
      depth: r.depth,
      levelName: r.level_name,
      code: r.code,
      name: r.name,
    });
  }
  return values;
}

type GrantRow = { kind: DimensionKind; is_all: boolean; value_ids: string[] };

/** Grant rows (one per dimension) as Visibility; null when there are none (not the viewer's to see). */
function toVisibility(rows: GrantRow[]): Visibility | null {
  const byKind = new Map(rows.map((r) => [r.kind, { isAll: r.is_all, valueIds: r.value_ids }]));
  const trade = byKind.get("trade");
  const location = byKind.get("location");
  return trade && location ? { trade, location } : null;
}

const onProject = (trx: Trx, projectId: string) =>
  trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();

/** A Project's Trades and Locations, for its Members; null when it isn't one of theirs. */
export function listDimensions(db: Db, memberId: string, projectId: string): Promise<DimensionValues | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await onProject(trx, projectId))) return null;
    const rows = await trx
      .selectFrom("dimension_value as v")
      .innerJoin("visibility_dimension as d", "d.id", "v.dimension_id")
      .select(["d.kind", "v.id", "v.parent_id", "v.depth", "v.code", "v.name", "v.level_name"])
      .where("v.project_id", "=", projectId)
      .orderBy("v.depth")
      .orderBy("v.sort")
      .orderBy("v.id")
      .execute();
    return toValues(rows as ValueRow[]);
  });
}

/** A Project Admin adds a Trade, or a Location (under `parentId`, or a Zone). */
export function addDimensionValue(
  db: Db,
  memberId: string,
  projectId: string,
  kind: DimensionKind,
  input: { code: string; name: BilingualText; parentId?: string | null },
): Promise<AddValueResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<AddValueResult> => {
      const { rows } = await sql<{ outcome: "added" | Exclude<AddValueResult, { ok: true } | Forbidden>["reason"]; value_id: string | null }>`
        select outcome, value_id from app.add_dimension_value(
          ${projectId}::uuid, ${kind}, ${input.parentId ?? null}::uuid, ${input.code}, ${JSON.stringify(input.name)}::jsonb)
      `.execute(trx);
      const { outcome, value_id } = rows[0]!;
      return outcome === "added" ? { ok: true, id: value_id! } : { ok: false, reason: outcome };
    }),
  );
}

/** The values the acting Member covers on one of their Projects; null when it isn't one of theirs. */
export function myVisibility(db: Db, memberId: string, projectId: string): Promise<DimensionValues | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await onProject(trx, projectId))) return null;
    const { rows } = await sql<ValueRow>`
      select mv.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
      from app.my_visibility(${projectId}::uuid) mv
      join dimension_value v on v.id = mv.value_id
      order by v.depth, v.sort, v.id
    `.execute(trx);
    return toValues(rows);
  });
}

async function participantVisibilityIn(trx: Trx, participantId: string): Promise<ParticipantVisibility | null> {
  const grants = await sql<GrantRow>`select * from app.participant_grants(${participantId}::uuid)`.execute(trx);
  const visibility = toVisibility(grants.rows);
  if (!visibility) return null;
  const covered = await sql<ValueRow>`select * from app.participant_covered_values(${participantId}::uuid)`.execute(trx);
  return { visibility, covered: toValues(covered.rows) };
}

/**
 * A Participant's Visibility and what it covers, for its own Company and the
 * Project's Project Admins; null for anyone else.
 */
export function getParticipantVisibility(
  db: Db,
  memberId: string,
  participantId: string,
): Promise<ParticipantVisibility | null> {
  return withMember(db, memberId, (trx) => participantVisibilityIn(trx, participantId));
}

type SetRefusal = Exclude<SetVisibilityResult, { ok: true } | Forbidden>["reason"];

/** An app.set_*_visibility outcome other than 'set': rolls the whole save back. */
class Refused extends Error {
  constructor(readonly reason: SetRefusal) {
    super(reason);
  }
}

/** Sets every dimension with `setOne` in one transaction: all of them, or none. */
async function setEveryDimension(
  db: Db,
  memberId: string,
  request: SetVisibilityRequest,
  setOne: (trx: Trx, kind: DimensionKind, grant: SetVisibilityRequest[DimensionKind]) => Promise<string>,
): Promise<SetVisibilityResult> {
  try {
    return await refusedAsForbidden(() =>
      withMember(db, memberId, async (trx) => {
        for (const kind of dimensionKinds) {
          const outcome = await setOne(trx, kind, request[kind]);
          if (outcome !== "set") throw new Refused(outcome as SetRefusal);
        }
        return { ok: true } as const;
      }),
    );
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }
}

/** A Project Admin sets a Participant's Visibility. */
export function setParticipantVisibility(
  db: Db,
  memberId: string,
  participantId: string,
  request: SetVisibilityRequest,
  now: Date,
): Promise<SetVisibilityResult> {
  return setEveryDimension(db, memberId, request, async (trx, kind, grant) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.set_participant_visibility(
        ${participantId}::uuid, ${kind}, ${grant.isAll}, ${grant.valueIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    return rows[0]!.outcome;
  });
}

/**
 * A Project Member's Visibility, with their Participant's to choose within, for
 * the Participant's own Company only; null for anyone else.
 */
export function getMemberVisibility(
  db: Db,
  memberId: string,
  participantId: string,
  targetId: string,
): Promise<MemberVisibility | null> {
  return withMember(db, memberId, async (trx) => {
    const grants = await sql<GrantRow>`select * from app.member_grants(${participantId}::uuid, ${targetId}::uuid)`.execute(trx);
    const visibility = toVisibility(grants.rows);
    if (!visibility) return null;
    const member = await trx
      .selectFrom("member")
      .select(["id", "full_name as fullName"])
      .where("id", "=", targetId)
      .executeTakeFirst();
    const participant = await participantVisibilityIn(trx, participantId);
    if (!member || !participant) return null;
    return { member, visibility, participant };
  });
}

/** The Participant's Authorized Person sets a Project Member's Visibility, within the Participant's. */
export function setMemberVisibility(
  db: Db,
  memberId: string,
  participantId: string,
  targetId: string,
  request: SetVisibilityRequest,
  now: Date,
): Promise<SetVisibilityResult> {
  return setEveryDimension(db, memberId, request, async (trx, kind, grant) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.set_member_visibility(
        ${participantId}::uuid, ${targetId}::uuid, ${kind}, ${grant.isAll}, ${grant.valueIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    return rows[0]!.outcome;
  });
}
