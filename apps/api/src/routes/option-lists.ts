import { optionLists } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { listOptionLists } from "../option-lists/option-lists.ts";

// Option Lists are read here, by every Member. There is no route that changes
// one: Rabaed Engineers edit them in Rabaed Admin (RP-279).
export const optionListRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/option-lists", { schema: { response: { 200: optionLists } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return { optionLists: await listOptionLists(ctx.db, memberId) };
    });
  };
