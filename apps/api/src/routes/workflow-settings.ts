import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import { readScreenPins, readWorkflowSettings, readWorkflowVersion } from "../projects/workflow-settings.ts";

const projectParams = z.object({ projectId: z.string() });
const versionParams = z.object({ workflowId: z.string(), versionNo: z.string() });

// Project → Settings → Workflows (RP-441, WF-18): what the page reads. Every Member of a
// Project reads which Workflow each Type runs and each published Version (V20); the
// Library and the Project's drafts only the Project Admins, an exception only its
// Participant's Members and the Project Admins (V15). Anyone else, and a made-up id, gets
// the same 404.
export const workflowSettingsRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/projects/:projectId/workflow-settings", { schema: { params: projectParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readWorkflowSettings(ctx.db, memberId, idOrNotFound(request.params.projectId)));
    });

    app.get("/v1/projects/:projectId/screen-pins", { schema: { params: projectParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readScreenPins(ctx.db, memberId, idOrNotFound(request.params.projectId)));
    });

    app.get("/v1/workflows/:workflowId/versions/:versionNo", { schema: { params: versionParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const versionNo = Number(request.params.versionNo);
      if (!Number.isInteger(versionNo) || versionNo < 1) throw notFound();
      return visibleOrNotFound(readWorkflowVersion(ctx.db, memberId, idOrNotFound(request.params.workflowId), versionNo));
    });
  };
