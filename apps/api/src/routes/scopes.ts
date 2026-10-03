import { addScopeRequest, scopes, updateScopeRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { addScope, listParticipantScopes, listScopes, updateScope } from "../projects/scopes.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const participantParams = z.object({ participantId: z.string() });
const scopeParams = z.object({ scopeId: z.string() });
const created = z.object({ id: z.uuid() });

// Scopes and Sub-scopes under a Project's Trades (Project Settings → Trades).
// Every Project Member reads them; an Authorized Person who isn't a Project
// Member reads those of the Trades their Participant covers (the V16 line).
// Only a Project Admin changes them: anyone else gets a 404, exactly like a
// made-up id, so it names nothing.
export const scopeRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/scopes",
      { schema: { params: projectParams, response: { 200: scopes } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return { scopes: await visibleOrNotFound(listScopes(ctx.db, memberId, idOrNotFound(request.params.projectId))) };
      },
    );

    app.post(
      "/v1/projects/:projectId/scopes",
      { schema: { params: projectParams, body: addScopeRequest, response: { 201: created } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await addScope(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body);
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.patch(
      "/v1/scopes/:scopeId",
      { schema: { params: scopeParams, body: updateScopeRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await updateScope(ctx.db, memberId, idOrNotFound(request.params.scopeId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.get(
      "/v1/participants/:participantId/scopes",
      { schema: { params: participantParams, response: { 200: scopes } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        return { scopes: await visibleOrNotFound(listParticipantScopes(ctx.db, memberId, participantId)) };
      },
    );
  };
