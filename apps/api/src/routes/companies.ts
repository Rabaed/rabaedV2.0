import { withMember } from "@rabaed/db";
import { bilingualText, signedInMember } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, notSignedIn } from "../http-error.ts";

const company = z.object({
  id: z.uuid(),
  legalName: bilingualText,
  crNumber: z.string(),
  vatNumber: z.string(),
  status: z.enum(["active", "suspended"]),
  authorizedPersonId: z.uuid().nullable(),
});

export const companyRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/me", { schema: { response: { 200: signedInMember } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      // Read through RLS as the Member, so the session provably reaches the database.
      const row = await withMember(ctx.db, memberId, (trx) =>
        trx
          .selectFrom("member as m")
          .innerJoin("company as c", "c.id", "m.company_id")
          .select([
            "m.id",
            "m.email",
            "m.full_name",
            "m.locale",
            "m.can_create_projects",
            "c.id as company_id",
            "c.legal_name",
            "c.authorized_person_id",
          ])
          .where("m.id", "=", memberId)
          .executeTakeFirst(),
      );
      if (!row) throw notSignedIn();
      return {
        member: {
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          locale: row.locale,
          isAuthorizedPerson: row.authorized_person_id === row.id,
          canCreateProjects: row.can_create_projects,
        },
        company: { id: row.company_id, legalName: row.legal_name },
      };
    });

    app.get(
      "/v1/companies/:companyId",
      { schema: { params: z.object({ companyId: z.string() }), response: { 200: company } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const companyId = idOrNotFound(request.params.companyId);
        // No filter beyond the id: RLS decides, and anything hidden is a 404.
        const row = await withMember(ctx.db, memberId, (trx) =>
          trx.selectFrom("company").selectAll().where("id", "=", companyId).executeTakeFirst(),
        );
        if (!row) throw notFound();
        return {
          id: row.id,
          legalName: row.legal_name,
          crNumber: row.cr_number,
          vatNumber: row.vat_number,
          status: row.status,
          authorizedPersonId: row.authorized_person_id,
        };
      },
    );
  };
