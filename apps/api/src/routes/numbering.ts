import { numberingSettings, saveNumberingRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { getNumberingSettings, saveNumberingPattern } from "../projects/numbering.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });

// Project Settings → Numbering (RP-313). Every Project Member reads the
// Project's Numbering Pattern and per-Type overrides; only a Project Admin saves
// one. Anyone else, or anyone outside the Project, gets a 404 exactly like a
// made-up id, so it names nothing.
export const numberingRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/numbering",
      { schema: { params: projectParams, response: { 200: numberingSettings } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getNumberingSettings(ctx.db, memberId, idOrNotFound(request.params.projectId), ctx.now()));
      },
    );

    app.put(
      "/v1/projects/:projectId/numbering",
      { schema: { params: projectParams, body: saveNumberingRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const result = await saveNumberingPattern(ctx.db, memberId, projectId, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
