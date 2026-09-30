import type { Db } from "@rabaed/db";
import type { OnboardingLeads } from "@rabaed/domain";
import { sql } from "kysely";
import { asEngineer } from "../admin/admin-action.ts";

/**
 * Every onboarding lead, newest first: a CR number a Project Admin invited that
 * wasn't on Rabaed, with the Project and Host Company that asked, and, once
 * Rabaed onboarded the Company, the Participant Invitation it became. Read on the
 * admin connection and logged with the Engineer's reason (V9, ADR 0009).
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
