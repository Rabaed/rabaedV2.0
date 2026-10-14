import { withMember, type Db } from "@rabaed/db";
import type { AddApprovedSupplierRequest, ApprovedSupplier, ApprovedSuppliersQuery } from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// The Approved Supplier List (RP-592, V10). Reads go through row-level security
// and the table's column grants, so they can't carry what put a supplier there;
// writes through the app.* functions of the approved_supplier_list migration.
// Anyone but a Project Admin who tries to change it gets 'not_found'.

const addRefusals = ["not_found", "project_closed", "trade_not_found", "scope_not_found", "supplier_exists"] as const;
export type AddApprovedSupplierResult = { ok: true; id: string } | { ok: false; reason: (typeof addRefusals)[number] };

const withdrawRefusals = ["not_found", "project_closed"] as const;
export type WithdrawApprovedSupplierResult = { ok: true } | { ok: false; reason: (typeof withdrawRefusals)[number] };

/** A Project's Approved Supplier List for its Members, filtered; null when it isn't one of their Projects. */
export function listApprovedSuppliers(
  db: Db,
  memberId: string,
  projectId: string,
  query: ApprovedSuppliersQuery,
): Promise<ApprovedSupplier[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    let rows = trx
      .selectFrom("approved_supplier as s")
      .innerJoin("dimension_value as t", "t.id", "s.trade_value_id")
      .select(["s.id", "s.name", "s.trade_value_id", "s.scope_id", "s.status"])
      .where("s.project_id", "=", projectId);
    if (query.tradeId) rows = rows.where("s.trade_value_id", "=", query.tradeId);
    if (query.status) rows = rows.where("s.status", "=", query.status);
    const found = await rows
      // By Trade, as the Trades are listed; then by name.
      .orderBy("t.sort")
      .orderBy("t.id")
      .orderBy(sql`lower(s.name ->> 'en')`)
      .orderBy("s.id")
      .execute();
    return found.map((r) => ({ id: r.id, name: r.name, tradeId: r.trade_value_id, scopeId: r.scope_id, status: r.status }));
  });
}

/** A Project Admin adds a supplier by hand to one of the Project's Trades. */
export function addApprovedSupplier(
  db: Db,
  memberId: string,
  projectId: string,
  input: AddApprovedSupplierRequest,
  now: Date,
): Promise<AddApprovedSupplierResult> {
  return withMember(db, memberId, async (trx): Promise<AddApprovedSupplierResult> => {
    const { rows } = await sql<{ outcome: string; supplier_id: string | null }>`
      select outcome, supplier_id from app.add_approved_supplier(
        ${projectId}::uuid, ${input.tradeId}::uuid, ${input.scopeId}::uuid, ${JSON.stringify(input.name)}::jsonb, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["added", ...addRefusals]);
    return outcome === "added" ? { ok: true, id: rows[0]!.supplier_id! } : { ok: false, reason: outcome };
  });
}

/** A Project Admin withdraws a supplier: it stays listed, withdrawn. */
export function withdrawApprovedSupplier(db: Db, memberId: string, supplierId: string, now: Date): Promise<WithdrawApprovedSupplierResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.withdraw_approved_supplier(${supplierId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "withdrawn", withdrawRefusals);
  });
}
