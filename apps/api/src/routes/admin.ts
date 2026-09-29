import { engineerReason, onboardCompanyRequest, onboardingLeads, signInRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { HttpError } from "../http-error.ts";
import { listOnboardingLeads } from "../identity/onboarding-leads.ts";
import { onboardCompany } from "../identity/onboarding.ts";
import { signInHandler } from "./session.ts";

// Rabaed Admin. API only in the walking skeleton; its UI comes later.
export const adminRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/v1/session", { schema: { body: signInRequest } }, signInHandler(ctx, "engineer"));

    app.post(
      "/v1/companies",
      {
        // Check the caller before validating the body, so anyone else gets 404 either way.
        onRequest: async (request) => {
          ctx.requireEngineer(request);
        },
        schema: {
          body: onboardCompanyRequest,
          response: {
            201: z.object({
              companyId: z.uuid(),
              authorizedPersonId: z.uuid(),
              invitation: z.object({ token: z.string(), expiresAt: z.date() }),
            }),
          },
        },
      },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await onboardCompany(
          ctx.adminDb,
          engineerId,
          request.body,
          ctx.now(),
          ctx.config.invitationTtlMs,
        );
        if (!result.ok) throw new HttpError(409, `duplicate_${result.conflict}`);
        return reply.code(201).send({
          companyId: result.companyId,
          authorizedPersonId: result.authorizedPersonId,
          invitation: result.invitation,
        });
      },
    );

    // The CR numbers Project Admins invited that aren't on Rabaed, for Rabaed to onboard (ADR 0009).
    app.get(
      "/v1/onboarding-leads",
      {
        onRequest: async (request) => {
          ctx.requireEngineer(request);
        },
        schema: { querystring: z.object({ reason: engineerReason }), response: { 200: onboardingLeads } },
      },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        return { leads: await listOnboardingLeads(ctx.adminDb, engineerId, request.query.reason) };
      },
    );
  };
