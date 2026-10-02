import { pingDatabase } from "@rabaed/db";
import { healthResponse } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AdminContext } from "../app.ts";

export const healthRoutes =
  ({ db, config }: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Out of the request log: the load balancer and ECS ask every 15 seconds.
    app.get("/health", { logLevel: "warn", schema: { response: { 200: healthResponse, 503: healthResponse } } }, async (_request, reply) => {
      const ok = await pingDatabase(db);
      const { version } = config;
      return reply
        .code(ok ? 200 : 503)
        .send(ok ? { status: "ok", database: "ok", version } : { status: "degraded", database: "unavailable", version });
    });
  };
