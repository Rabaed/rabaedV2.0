import { onboardCompanyRequest, signInRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { HttpError } from "../http-error.ts";
import { onboardCompany } from "../identity/onboarding.ts";
import { signIn } from "../identity/sessions.ts";

// Rabaed Admin. API only in the walking skeleton; its UI comes later.
export const adminRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/v1/session", { schema: { body: signInRequest } }, async (request, reply) => {
      const { email, password } = request.body;
      const session = await signIn(ctx.db, "engineer", email, password, ctx.now(), ctx.config.sessionTtlMs);
      if (!session) throw new HttpError(401, "invalid_credentials");
      ctx.setSessionCookie(reply, session);
      return reply.code(204).send();
    });

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
  };
