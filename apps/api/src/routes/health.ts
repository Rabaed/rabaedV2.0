import { pingDatabase } from "@rabaed/db";
import { healthResponse } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";

export const healthRoutes =
  ({ db }: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/health", { schema: { response: { 200: healthResponse, 503: healthResponse } } }, async (_request, reply) => {
      const ok = await pingDatabase(db);
      return reply
        .code(ok ? 200 : 503)
        .send(ok ? { status: "ok", database: "ok" } : { status: "degraded", database: "unavailable" });
    });
  };
