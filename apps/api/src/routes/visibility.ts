import {
  addLocationRequest,
  addTradeRequest,
  dimensionValues,
  memberVisibility,
  participantVisibility,
  setVisibilityRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound } from "../http-error.ts";
import {
  addDimensionValue,
  getMemberVisibility,
  getParticipantVisibility,
  listDimensions,
  myVisibility,
  setMemberVisibility,
  setParticipantVisibility,
} from "../projects/visibility.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const participantParams = z.object({ participantId: z.string() });
const memberParams = participantParams.extend({ memberId: z.string() });
const created = z.object({ id: z.uuid() });

// A Project's Trades and Locations, and who covers which of them. Every Project
// Member sees the Trades and Locations; only a Project Admin changes them and
// grants each Participant Visibility; only a Participant's Authorized Person
// narrows it for its Project Members, whose grants only its own Company sees.
// A Visibility is saved whole, every dimension at once, or not at all.
export const visibilityRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/dimensions",
      { schema: { params: projectParams, response: { 200: dimensionValues } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const values = await listDimensions(ctx.db, memberId, idOrNotFound(request.params.projectId));
        if (!values) throw notFound();
        return values;
      },
    );

    for (const [kind, body] of [
      ["trade", addTradeRequest],
      ["location", addLocationRequest],
    ] as const) {
      app.post(
        `/v1/projects/:projectId/${kind}s`,
        { schema: { params: projectParams, body, response: { 201: created } } },
        async (request, reply) => {
          const memberId = ctx.requireMember(request);
          const projectId = idOrNotFound(request.params.projectId);
          const result = await addDimensionValue(ctx.db, memberId, projectId, kind, request.body);
          if (!result.ok) throw refusal(result);
          return reply.code(201).send({ id: result.id });
        },
      );
    }

    app.get(
      "/v1/projects/:projectId/visibility",
      { schema: { params: projectParams, response: { 200: dimensionValues } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const values = await myVisibility(ctx.db, memberId, idOrNotFound(request.params.projectId));
        if (!values) throw notFound();
        return values;
      },
    );

    app.get(
      "/v1/participants/:participantId/visibility",
      { schema: { params: participantParams, response: { 200: participantVisibility } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await getParticipantVisibility(ctx.db, memberId, idOrNotFound(request.params.participantId));
        if (!result) throw notFound();
        return result;
      },
    );

    // Anyone but a Project Admin gets a 404, exactly like a made-up id, so it
    // never reveals that a Participant exists (RP-233).
    app.put(
      "/v1/participants/:participantId/visibility",
      { schema: { params: participantParams, body: setVisibilityRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await setParticipantVisibility(ctx.db, memberId, participantId, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.get(
      "/v1/participants/:participantId/members/:memberId/visibility",
      { schema: { params: memberParams, response: { 200: memberVisibility } } },
      async (request) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await getMemberVisibility(ctx.db, actorId, participantId, idOrNotFound(request.params.memberId));
        if (!result) throw notFound();
        return result;
      },
    );

    app.put(
      "/v1/participants/:participantId/members/:memberId/visibility",
      { schema: { params: memberParams, body: setVisibilityRequest } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        const result = await setMemberVisibility(ctx.db, actorId, participantId, target, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
