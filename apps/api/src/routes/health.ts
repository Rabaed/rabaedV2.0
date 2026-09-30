import { pingDatabase } from "@rabaed/db";
import { healthResponse } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";

export const healthRoutes =
  ({ db, config }: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Not in the request log: ECS and the load balancer (through web) ask every
    // 15 seconds, which would drown the api 5xx rate the monitoring stack reads.
    const quiet = { logLevel: "warn" } as const;
    app.get("/health", { ...quiet, schema: { response: { 200: healthResponse, 503: healthResponse } } }, async (_request, reply) => {
      const ok = await pingDatabase(db);
      const { version } = config;
      return reply
        // RP-221 rollback test: ECS sets this variable, so only deployed tasks fail. Reverted right after.
        .code(ok && !process.env.ECS_CONTAINER_METADATA_URI_V4 ? 200 : 503)
        .send(ok ? { status: "ok", database: "ok", version } : { status: "degraded", database: "unavailable", version });
    });
  };
