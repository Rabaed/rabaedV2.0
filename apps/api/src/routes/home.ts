import { home } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { getHome } from "../home/home.ts";

// Home across the Member's Projects (RP-407): counts, Needs my action, recent
// activity and their Projects, each only what the per-Project reads show them.
export const homeRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/home", { schema: { response: { 200: home } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return getHome(ctx.db, memberId, ctx.now());
    });
  };
