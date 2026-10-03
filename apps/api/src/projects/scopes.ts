import { withMember, type Db } from "@rabaed/db";
import type { AddScopeRequest, BilingualText, Scope, UpdateScopeRequest } from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Scopes and Sub-scopes under a Project's Trades. Writes go through the app.*
// functions of the scopes migration; reads go through RLS or those functions.
// Anyone but a Project Admin who tries to change them gets 'not_found'.

const addScopeRefusals = ["not_found", "project_closed", "trade_not_found", "parent_not_found"] as const;
export type AddScopeResult = { ok: true; id: string } | { ok: false; reason: (typeof addScopeRefusals)[number] };

const updateScopeRefusals = ["not_found", "project_closed", "parent_deactivated"] as const;
export type UpdateScopeResult = { ok: true } | { ok: false; reason: (typeof updateScopeRefusals)[number] };

type StoredScope = {
  id: string;
  trade_value_id: string;
  parent_id: string | null;
  name: BilingualText;
  status: "active" | "deactivated";
};

const toScope = (r: StoredScope): Scope => ({
  id: r.id,
  tradeId: r.trade_value_id,
  parentId: r.parent_id,
  name: r.name,
  active: r.status === "active",
});

/** A Project's Scopes and Sub-scopes, for its Members; null when it isn't one of theirs. */
export function listScopes(db: Db, memberId: string, projectId: string): Promise<Scope[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    const rows = await trx
      .selectFrom("scope as s")
      .innerJoin("dimension_value as t", "t.id", "s.trade_value_id")
      .leftJoin("scope as p", "p.id", "s.parent_id")
      .select(["s.id", "s.trade_value_id", "s.parent_id", "s.name", "s.status"])
      .where("s.project_id", "=", projectId)
      // By Trade, as the Trades are listed; each Scope followed by its Sub-scopes.
      .orderBy("t.sort")
      .orderBy("t.id")
      .orderBy(sql`coalesce(p.sort, s.sort)`)
      .orderBy(sql`coalesce(s.parent_id, s.id)`)
      .orderBy("s.depth")
      .orderBy("s.sort")
      .execute();
    return rows.map(toScope);
  });
}

/**
 * The Scopes and Sub-scopes of the Trades a Participant covers, for its own
 * Company (its Authorized Person even before they are a Project Member) and the
 * Project's Project Admins; null for anyone else.
 */
export function listParticipantScopes(db: Db, memberId: string, participantId: string): Promise<Scope[] | null> {
  return withMember(db, memberId, async (trx) => {
    // app.participant_grants answers the same people as app.participant_scopes,
    // and, unlike it, has rows for them even when there are no Scopes yet.
    const grants = await sql`select 1 from app.participant_grants(${participantId}::uuid)`.execute(trx);
    if (grants.rows.length === 0) return null;
    const { rows } = await sql<StoredScope>`
      select id, trade_value_id, parent_id, name, status from app.participant_scopes(${participantId}::uuid)
    `.execute(trx);
    return rows.map(toScope);
  });
}

/** A Project Admin adds a Scope under a Trade, or a Sub-scope under one of its Scopes. */
export function addScope(db: Db, memberId: string, projectId: string, input: AddScopeRequest): Promise<AddScopeResult> {
  return withMember(db, memberId, async (trx): Promise<AddScopeResult> => {
    const { rows } = await sql<{ outcome: string; scope_id: string | null }>`
      select outcome, scope_id from app.add_scope(
        ${projectId}::uuid, ${input.tradeId}::uuid, ${input.parentId}::uuid, ${JSON.stringify(input.name)}::jsonb)
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["added", ...addScopeRefusals]);
    return outcome === "added" ? { ok: true, id: rows[0]!.scope_id! } : { ok: false, reason: outcome };
  });
}

/** A Project Admin renames a Scope or Sub-scope, deactivates or reactivates it, or both. */
export function updateScope(
  db: Db,
  memberId: string,
  scopeId: string,
  change: UpdateScopeRequest,
  now: Date,
): Promise<UpdateScopeResult> {
  return withMember(db, memberId, async (trx) => {
    const name = change.name === undefined ? null : JSON.stringify(change.name);
    const { rows } = await sql<{ outcome: string }>`
      select app.update_scope(${scopeId}::uuid, ${name}::jsonb, ${change.active ?? null}::boolean, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "updated", updateScopeRefusals);
  });
}
