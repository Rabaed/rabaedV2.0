import { addOutcomeRequest, changeOutcomeRequest, reorderOutcomesRequest, typeOutcomes } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { addOutcome, changeOutcome, getTypeOutcomes, reorderOutcomes } from "../projects/outcomes.ts";
import { throwIfRefused } from "../refusals.ts";

const typeParams = z.object({ projectId: z.string(), type: z.string() });
const outcomeParams = typeParams.extend({ code: z.string() });

// A Work Item Type's outcome set on a Project (RP-429, WF-6). Every Project Member
// reads it; only a Project Admin adds an outcome, changes one's names and follow-up
// actions, or reorders them, on the Project's copy. Anyone else, or anyone outside
// the Project, gets a 404 exactly like a made-up id.
export const outcomeRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/work-item-types/:type/outcomes",
      { schema: { params: typeParams, response: { 200: typeOutcomes } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        return visibleOrNotFound(getTypeOutcomes(ctx.db, memberId, projectId, request.params.type));
      },
    );

    app.post(
      "/v1/projects/:projectId/work-item-types/:type/outcomes",
      { schema: { params: typeParams, body: addOutcomeRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        throwIfRefused(await addOutcome(ctx.db, memberId, projectId, request.params.type, request.body));
        return reply.code(201).send({ code: request.body.code });
      },
    );

    app.put(
      "/v1/projects/:projectId/work-item-types/:type/outcomes/order",
      { schema: { params: typeParams, body: reorderOutcomesRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        throwIfRefused(await reorderOutcomes(ctx.db, memberId, projectId, request.params.type, request.body.codes));
        return reply.code(204).send();
      },
    );

    app.patch(
      "/v1/projects/:projectId/work-item-types/:type/outcomes/:code",
      { schema: { params: outcomeParams, body: changeOutcomeRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        throwIfRefused(await changeOutcome(ctx.db, memberId, projectId, request.params.type, request.params.code, request.body));
        return reply.code(204).send();
      },
    );
  };
