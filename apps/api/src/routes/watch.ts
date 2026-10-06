import { watchState } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { getWatchState, unwatchWorkItem, watchWorkItem } from "../notifications/watch.ts";
import { refusal } from "../refusals.ts";

const workItemParams = z.object({ workItemId: z.string() });

// Watch (RP-354): the signed-in Member's own Watch on an item they see, which
// covers its whole Revision chain. A hidden item answers exactly like one that
// doesn't exist (404). No route returns who else watches, nor how many do.
export const watchRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/work-items/:workItemId/watch",
      { schema: { params: workItemParams, response: { 200: watchState } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWatchState(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    app.put("/v1/work-items/:workItemId/watch", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await watchWorkItem(ctx.db, memberId, idOrNotFound(request.params.workItemId));
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

    app.delete("/v1/work-items/:workItemId/watch", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await unwatchWorkItem(ctx.db, memberId, idOrNotFound(request.params.workItemId));
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });
  };
