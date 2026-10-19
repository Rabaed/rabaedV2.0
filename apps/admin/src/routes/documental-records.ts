import { engineerReason } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { listDocumentalRecordAlerts, reproduceDocumentalRecord } from "../documental-records.ts";

const bilingual = z.object({ en: z.string(), ar: z.string() });
const alerts = z.object({
  alerts: z.array(
    z.object({
      workItemId: z.uuid(),
      projectId: z.uuid(),
      projectName: bilingual,
      documentNumber: z.string().nullable(),
      status: z.enum(["published", "failed_checks", "job_failed"]),
      problems: z.array(z.string()),
      raisedAt: z.iso.datetime(),
    }),
  ),
});

// Documental Records from Rabaed Admin (RP-155): the alerts a failed check raises, and
// Re-produce, each with the Engineer's reason in admin_action.
export const documentalRecordRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/documental-record-alerts", { schema: { querystring: z.object({ reason: engineerReason }), response: { 200: alerts } } }, async (request) => {
      const engineerId = ctx.requireEngineer(request);
      return { alerts: await listDocumentalRecordAlerts(ctx.db, engineerId, request.query.reason) };
    });

    app.post(
      "/v1/work-items/:workItemId/documental-record/reproduce",
      { schema: { params: z.object({ workItemId: z.uuid() }), body: z.object({ reason: engineerReason }) } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await reproduceDocumentalRecord(ctx.db, engineerId, request.params.workItemId, request.body.reason);
        if (result === "not_found") throw new HttpError(404, "not_found");
        if (result === "already_queued") throw new HttpError(409, "already_queued");
        return reply.code(202).send();
      },
    );
  };
