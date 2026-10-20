import { engineerReason } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { listDocumentalRecordAlerts, listRecordJobs, readDocumentalRecordHistory, reproduceDocumentalRecord, retryRecordJob } from "../documental-records.ts";

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

const recordJobs = z.object({
  jobs: z.array(
    z.object({
      outboxId: z.uuid(),
      kind: z.enum(["record", "reproduce"]),
      workItemId: z.uuid(),
      projectId: z.uuid(),
      projectName: bilingual,
      documentNumber: z.string().nullable(),
      state: z.enum(["failing", "dead"]),
      error: z.string(),
      attempts: z.number().int(),
      lastRanAt: z.iso.datetime().nullable(),
      nextTryAt: z.iso.datetime().nullable(),
    }),
  ),
});
const history = z.object({
  requests: z.array(
    z.object({
      requestedAt: z.iso.datetime(),
      engineerEmail: z.string(),
      reason: z.string(),
      outcome: z.enum(["replaced", "waiting", "job_failed", "checks_failed"]),
      replacedSha256: z.string().nullable(),
      newSha256: z.string().nullable(),
    }),
  ),
  checks: z.array(
    z.object({
      runKind: z.enum(["closure", "reproduce"]),
      passed: z.boolean(),
      problems: z.array(z.string()),
      ranAt: z.iso.datetime(),
    }),
  ),
});

// Documental Records from Rabaed Admin (RP-155): the alerts a failed check raises, and
// Re-produce, each with the Engineer's reason in admin_action. The Record Job Monitor (RP-670):
// the failing and dead record jobs, their retry, and a record's history.
export const documentalRecordRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/record-jobs", { schema: { querystring: z.object({ reason: engineerReason }), response: { 200: recordJobs } } }, async (request) => {
      const engineerId = ctx.requireEngineer(request);
      return { jobs: await listRecordJobs(ctx.db, engineerId, request.query.reason) };
    });

    app.post(
      "/v1/record-jobs/:outboxId/retry",
      { schema: { params: z.object({ outboxId: z.uuid() }), body: z.object({ reason: engineerReason }) } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await retryRecordJob(ctx.db, engineerId, request.params.outboxId, request.body.reason);
        if (result === "not_found") throw new HttpError(404, "not_found");
        if (result === "already_queued") throw new HttpError(409, "already_queued");
        return reply.code(202).send();
      },
    );

    app.get(
      "/v1/work-items/:workItemId/documental-record/history",
      { schema: { params: z.object({ workItemId: z.uuid() }), querystring: z.object({ reason: engineerReason }), response: { 200: history } } },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        return readDocumentalRecordHistory(ctx.db, engineerId, request.params.workItemId, request.query.reason);
      },
    );

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
