import { counterPreview, counterStart, counterStartRequest, counterValues, numberingCounters } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { listNumberingCounters, previewNumberingCounter, setNumberingCounterStart } from "../projects/numbering-counters.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });

// Numbering counters and starting numbers (Project Settings → Numbering; RP-315).
// Only the Project's Project Admins read counters or set a starting number:
// anyone else gets a 404, exactly like a made-up Project, so it names nothing
// (visibility.md scenario 55).
export const numberingCounterRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/numbering/counters",
      { schema: { params: projectParams, response: { 200: numberingCounters } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(listNumberingCounters(ctx.db, memberId, idOrNotFound(request.params.projectId)));
      },
    );

    // The counter chosen values fall under, for the page's example of the next number.
    app.get(
      "/v1/projects/:projectId/numbering/counter",
      { schema: { params: projectParams, querystring: counterValues, response: { 200: counterPreview } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const result = await previewNumberingCounter(ctx.db, memberId, projectId, request.query, ctx.now());
        if (!result.ok) throw refusal(result);
        return result.preview;
      },
    );

    app.put(
      "/v1/projects/:projectId/numbering/counters/start",
      { schema: { params: projectParams, body: counterStartRequest, response: { 200: counterStart } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const result = await setNumberingCounterStart(ctx.db, memberId, projectId, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return result.start;
      },
    );
  };
