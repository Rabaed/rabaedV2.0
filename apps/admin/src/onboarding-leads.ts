import type { Db } from "@rabaed/db";
import type { OnboardingLeads } from "@rabaed/domain";
import { sql } from "kysely";
import { asEngineer } from "./admin-action.ts";

/**
 * Rabaed's onboarding work list, newest first: each CR number a Project Admin
 * invited that wasn't on Rabaed, with the Project and Host Company that asked,
 * and, once Rabaed onboarded the Company, the Participant Invitation it became.
 * Leads Rabaed closed, or their Project Admin withdrew, are left out. Read on
 * the admin connection and logged with the Engineer's reason (V9, ADR 0009).
 */
export function listOnboardingLeads(adminDb: Db, engineerId: string, reason: string): Promise<OnboardingLeads["leads"]> {
  return asEngineer(adminDb, { engineerId, action: "read_onboarding_leads", reason }, async (trx) => {
    const rows = await trx
      .selectFrom("onboarding_lead as l")
      .innerJoin("project as p", "p.id", "l.project_id")
      .innerJoin("company as host", "host.id", "p.host_company_id")
      .innerJoin("project_role as r", "r.id", "l.project_role_id")
      .select([
        "l.id",
        "l.cr_number",
        sql<Date>`l.updated_at`.as("requested_at"),
        "p.id as project_id",
        "p.project_number",
        "p.code",
        "p.name",
        "host.id as host_id",
        "host.legal_name as host_name",
        "r.base_role",
        "l.converted_at",
        "l.participant_id",
      ])
      .where("l.closed_at", "is", null)
      .where("l.withdrawn_at", "is", null)
      .orderBy("l.updated_at", "desc")
      .orderBy("l.id", "desc")
      .execute();
    const leads = rows.map((r) => ({
      id: r.id,
      crNumber: r.cr_number,
      project: { id: r.project_id, projectNumber: r.project_number, code: r.code, name: r.name },
      hostCompany: { id: r.host_id, legalName: r.host_name },
      baseRole: r.base_role,
      requestedAt: r.requested_at.toISOString(),
      convertedAt: r.converted_at?.toISOString() ?? null,
      participantId: r.participant_id,
    }));
    return { target: { kind: "onboarding_lead", id: null }, after: { leadIds: leads.map((l) => l.id) }, result: leads };
  });
}

export type CloseLeadResult = { ok: true } | { ok: false; reason: "not_found" };

class NotClosed extends Error {
  constructor() {
    super("not_found");
  }
}

/**
 * A Rabaed Engineer closes an open onboarding lead that won't be onboarded,
 * logged with the reason. It only leaves Rabaed's own list: the Project Admin
 * still sees their invitation pending until they withdraw it, since only an
 * invitation to a CR number not on Rabaed could vanish this way (ADR 0009).
 * Not found for a lead already closed, withdrawn or converted.
 */
export async function closeOnboardingLead(
  adminDb: Db,
  engineerId: string,
  leadId: string,
  reason: string,
  now: Date,
): Promise<CloseLeadResult> {
  try {
    await asEngineer(adminDb, { engineerId, action: "close_onboarding_lead", reason }, async (trx) => {
      // updated_at stays: it is the time on the Project Admin's pending row.
      const closed = await trx
        .updateTable("onboarding_lead")
        .set({ closed_at: now })
        .where("id", "=", leadId)
        .where("closed_at", "is", null)
        .where("withdrawn_at", "is", null)
        .where("converted_at", "is", null)
        .returning(["id", "cr_number", "project_id"])
        .executeTakeFirst();
      if (!closed) throw new NotClosed();
      return {
        target: { kind: "onboarding_lead", id: closed.id },
        after: { crNumber: closed.cr_number, projectId: closed.project_id, closedAt: now },
        result: undefined,
      };
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof NotClosed) return { ok: false, reason: "not_found" };
    throw error;
  }
}
