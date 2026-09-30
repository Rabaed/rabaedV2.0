import type { Db } from "@rabaed/db";
import type { OnboardCompanyRequest } from "@rabaed/domain";
import { sql } from "kysely";
import { asEngineer } from "../admin/admin-action.ts";
import { createInvitation, type Invitation } from "./invitations.ts";

type Conflict = "cr_number" | "vat_number" | "email";

export type OnboardingResult =
  | { ok: true; companyId: string; authorizedPersonId: string; invitation: Invitation }
  | { ok: false; conflict: Conflict };

const conflicts: Record<string, Conflict> = {
  company_cr_number_key: "cr_number",
  company_vat_number_key: "vat_number",
  member_email_key: "email",
};

/**
 * A Rabaed Engineer onboards a Company and invites its Authorized Person. Every
 * onboarding lead for its CR number becomes the Company's Participant Invitation
 * on that lead's Project, logged with the onboarding (ADR 0009).
 * The invitation token is returned once, to be passed to the Authorized Person
 * (email delivery comes later); only its hash is stored.
 */
export async function onboardCompany(
  adminDb: Db,
  engineerId: string,
  input: OnboardCompanyRequest,
  now: Date,
  invitationTtlMs: number,
): Promise<OnboardingResult> {
  try {
    return await asEngineer(adminDb, { engineerId, action: "onboard_company", reason: input.reason }, async (trx) => {
      const company = await trx
        .insertInto("company")
        .values({
          legal_name: JSON.stringify(input.legalName),
          cr_number: input.crNumber,
          vat_number: input.vatNumber,
          onboarded_by: engineerId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const person = await trx
        .insertInto("member")
        .values({
          company_id: company.id,
          email: input.authorizedPerson.email,
          full_name: JSON.stringify(input.authorizedPerson.fullName),
          locale: input.authorizedPerson.locale,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.updateTable("company").set({ authorized_person_id: person.id }).where("id", "=", company.id).execute();
      const invitation = await createInvitation(trx, person.id, { engineerId }, now, invitationTtlMs);
      // Every Project Admin who invited its CR number before now has it invited (RP-252).
      const { rows: invitedFromLeads } = await sql<{ lead_id: string; participant_id: string; project_id: string }>`
        select * from app.convert_onboarding_leads(${company.id}::uuid, ${now})
      `.execute(trx);

      return {
        target: { kind: "company", id: company.id },
        after: {
          legalName: input.legalName,
          crNumber: input.crNumber,
          vatNumber: input.vatNumber,
          authorizedPerson: { id: person.id, email: input.authorizedPerson.email },
          invitedFromLeads: invitedFromLeads.map((l) => ({
            leadId: l.lead_id,
            participantId: l.participant_id,
            projectId: l.project_id,
          })),
        },
        result: { ok: true, companyId: company.id, authorizedPersonId: person.id, invitation } as const,
      };
    });
  } catch (error) {
    const conflict = uniqueViolation(error);
    if (conflict) return { ok: false, conflict };
    throw error;
  }
}

function uniqueViolation(error: unknown): Conflict | null {
  const e = error as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint ? (conflicts[e.constraint] ?? null) : null;
}
