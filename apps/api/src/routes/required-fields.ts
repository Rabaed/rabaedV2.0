import { projectRequiredFields, setRequiredFieldRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { readRequiredFields, setRequiredField } from "../projects/required-fields.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });

// Project Settings → Required links (RP-82): the link questions of the Project's
// Types, and which of them the Project makes required, such as the WIR's Approved
// submittals. Every Project Member reads it (V20); only a Project Admin changes it:
// anyone else gets a 404, exactly like a made-up Project, so it names nothing.
export const requiredFieldRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/required-fields",
      { schema: { params: projectParams, response: { 200: projectRequiredFields } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(readRequiredFields(ctx.db, memberId, idOrNotFound(request.params.projectId)));
      },
    );

    app.put(
      "/v1/projects/:projectId/required-fields",
      { schema: { params: projectParams, body: setRequiredFieldRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await setRequiredField(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
