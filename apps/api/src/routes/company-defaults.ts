import { clearCompanyDefaultQuery, setCompanyDefaultRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { clearCompanyDefault, listCompanyDefaults, setCompanyDefault } from "../projects/company-defaults.ts";
import { refusal } from "../refusals.ts";

// Company defaults (RP-517; ADR 0019). A Company's Members read its defaults; only its
// Authorized Person marks or clears one, and anyone else, an item that is not in the
// Company's Library or a made-up id gets the same 404 (V18). The Library screen is RP-442.
export const companyDefaultRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/company-defaults", async (request) => {
      const memberId = ctx.requireMember(request);
      return listCompanyDefaults(ctx.db, memberId);
    });

    app.put("/v1/company-defaults", { schema: { body: setCompanyDefaultRequest } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await setCompanyDefault(ctx.db, memberId, request.body, ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

    app.delete("/v1/company-defaults", { schema: { querystring: clearCompanyDefaultQuery } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await clearCompanyDefault(ctx.db, memberId, request.query, ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });
  };
