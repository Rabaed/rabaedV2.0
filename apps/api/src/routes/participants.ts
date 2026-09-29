import {
  addParticipantRequest,
  addProjectMemberRequest,
  companyParticipations,
  participantMembers,
  projectParticipants,
  setMemberPositionsRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, idOrNotFound, notFound } from "../http-error.ts";
import {
  addParticipant,
  addProjectMember,
  listCompanyParticipations,
  listParticipantMembers,
  listParticipants,
  removeProjectMember,
  setMemberPositions,
} from "../projects/participants.ts";
import { refusal } from "../refusals.ts";

const participantParams = z.object({ participantId: z.string() });

// Participants of a Project, and each Participant's Project Members. A Project's
// Members see their own Company's Participant and the Host Company's name; its
// Project Admins see every Participant (V15). Only a Participant's own Company
// sees its Project Members, and only its Authorized Person changes them.
export const participantRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/participants",
      { schema: { params: z.object({ projectId: z.string() }), response: { 200: projectParticipants } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const participants = await listParticipants(ctx.db, memberId, idOrNotFound(request.params.projectId));
        if (!participants) throw notFound();
        return participants;
      },
    );

    app.post(
      "/v1/projects/:projectId/participants",
      {
        schema: {
          params: z.object({ projectId: z.string() }),
          body: addParticipantRequest,
          response: { 201: z.object({ participantId: z.uuid() }) },
        },
      },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await addParticipant(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body);
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ participantId: result.participantId });
      },
    );

    app.get("/v1/participants", { schema: { response: { 200: companyParticipations } } }, async (request) => {
      const actorId = ctx.requireMember(request);
      const result = await listCompanyParticipations(ctx.db, actorId);
      if (!result.ok) throw forbidden();
      return { participants: result.participations };
    });

    app.get(
      "/v1/participants/:participantId/members",
      { schema: { params: participantParams, response: { 200: participantMembers } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const list = await listParticipantMembers(ctx.db, memberId, idOrNotFound(request.params.participantId));
        if (!list) throw notFound();
        return list;
      },
    );

    app.post(
      "/v1/participants/:participantId/members",
      { schema: { params: participantParams, body: addProjectMemberRequest } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await addProjectMember(ctx.db, actorId, participantId, request.body.memberId, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.delete(
      "/v1/participants/:participantId/members/:memberId",
      { schema: { params: participantParams.extend({ memberId: z.string() }) } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        const result = await removeProjectMember(ctx.db, actorId, participantId, target, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.put(
      "/v1/participants/:participantId/members/:memberId/positions",
      { schema: { params: participantParams.extend({ memberId: z.string() }), body: setMemberPositionsRequest } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        const result = await setMemberPositions(ctx.db, actorId, participantId, target, request.body.positions);
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
