import { withMember, type Db } from "@rabaed/db";
import type { BilingualText, ClearCompanyDefaultQuery, CompanyDefaultKind, CompanyDefaults, SetCompanyDefaultRequest } from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";

// Company defaults (RP-517; ADR 0019; GLOSSARY "Company default"). The Authorized Person
// marks a Library Form, Workflow or Screen of their Company as its default for a Work Item
// Type, one per Type and kind; creating a Project then copies the creator's Company's
// defaults into it (app.create_project). Every Member of the Company reads them (its
// Library is private, V18); anyone else's attempt to change them is the plain 404.

/** The Member's Company's defaults, by Type and kind; row-level security keeps it to their own (V18). */
export function listCompanyDefaults(db: Db, memberId: string): Promise<CompanyDefaults> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ kind: CompanyDefaultKind; type_id: string; code: string; item_id: string; name: BilingualText }>`
      select d.kind, t.id as type_id, t.code,
        coalesce(d.form_definition_id, d.workflow_definition_id, d.screen_id) as item_id,
        coalesce(f.name, w.name, s.name) as name
      from company_default d
      join work_item_type t on t.id = d.work_item_type_id
      left join form_definition f on f.id = d.form_definition_id
      left join workflow_definition w on w.id = d.workflow_definition_id
      left join screen s on s.id = d.screen_id
      order by t.code, d.kind
    `.execute(trx);
    return {
      defaults: rows.map((r) => ({ kind: r.kind, workItemTypeId: r.type_id, workItemTypeCode: r.code, itemId: r.item_id, name: r.name })),
    };
  });
}

const setRefusals = ["not_found", "not_published", "not_for_type"] as const;

/** The Authorized Person marks a Library item of their Company as the default for a Type, replacing the one there was. */
export function setCompanyDefault(db: Db, memberId: string, input: SetCompanyDefaultRequest, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.set_company_default(${input.workItemTypeId}::uuid, ${input.kind}, ${input.itemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "set", setRefusals);
  });
}

/** The Authorized Person takes the default for a Type and kind away; Projects already created keep their copies. */
export function clearCompanyDefault(db: Db, memberId: string, input: ClearCompanyDefaultQuery, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.clear_company_default(${input.workItemTypeId}::uuid, ${input.kind}, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "cleared", ["not_found"] as const);
  });
}
