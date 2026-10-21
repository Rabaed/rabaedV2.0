import { snagReportRequest, snagReportState, workItemQuery } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import { askForSnagReport, snagReportOf } from "../work-items/snag-report.ts";

const projectParams = z.object({ projectId: z.string() });
const reportParams = projectParams.extend({ reportId: z.string() });

// The Snag List's PDF report (RP-677, spec RP-619). Asking reads the items as the viewer (the List's filters
// in the query string, or the chosen `ids`) and queues the worker; the viewer then asks after it until it
// is ready and gets a short-lived download link. A report is its asker's alone: anyone else, and a made-up
// id, get the plain 404.
export const snagReportRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      "/v1/projects/:projectId/snag-list/reports",
      { schema: { params: projectParams, querystring: workItemQuery, body: snagReportRequest, response: { 202: snagReportState } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const state = await askForSnagReport(ctx.db, memberId, idOrNotFound(request.params.projectId), request.query, request.body, ctx.now());
        if (!state) throw notFound();
        return reply.code(202).send(state);
      },
    );

    app.get(
      "/v1/projects/:projectId/snag-list/reports/:reportId",
      { schema: { params: reportParams, response: { 200: snagReportState } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        return visibleOrNotFound(snagReportOf(ctx.db, ctx.files, memberId, projectId, idOrNotFound(request.params.reportId), ctx.now()));
      },
    );
  };
