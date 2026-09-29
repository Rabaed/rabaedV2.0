import {
  addParticipantRequest,
  addProjectMemberRequest,
  companyInvitations,
  companyParticipations,
  participantMembers,
  projectInvitations,
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
  listCompanyInvitations,
  listCompanyParticipations,
  listParticipantMembers,
  listParticipants,
  listProjectInvitations,
  removeProjectMember,
  respondToInvitation,
  setMemberPositions,
} from "../projects/participants.ts";
import { refusal } from "../refusals.ts";

const participantParams = z.object({ participantId: z.string() });

// Participants of a Project, their invitations, and each Participant's Project
// Members. A Project Admin invites a Company by its CR number and gets one
// answer whether or not it is on Rabaed; the Company joins only when its
// Authorized Person accepts (ADR 0009). A Project's
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

    // 202 with no body, alike for a Company on Rabaed and a CR number that isn't (scenario 31).
    app.post(
      "/v1/projects/:projectId/participants",
      { schema: { params: z.object({ projectId: z.string() }), body: addParticipantRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const result = await addParticipant(ctx.db, memberId, projectId, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(202).send();
      },
    );

    app.get(
      "/v1/projects/:projectId/invitations",
      { schema: { params: z.object({ projectId: z.string() }), response: { 200: projectInvitations } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await listProjectInvitations(ctx.db, memberId, idOrNotFound(request.params.projectId));
        if (!result) throw notFound();
        if ("ok" in result) throw forbidden();
        return result;
      },
    );

    app.get("/v1/participant-invitations", { schema: { response: { 200: companyInvitations } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await listCompanyInvitations(ctx.db, memberId);
      if ("ok" in result) throw forbidden();
      return result;
    });

    for (const [answer, accept] of [["accept", true], ["decline", false]] as const) {
      app.post(
        `/v1/participant-invitations/:participantId/${answer}`,
        { schema: { params: participantParams } },
        async (request, reply) => {
          const memberId = ctx.requireMember(request);
          const participantId = idOrNotFound(request.params.participantId);
          const result = await respondToInvitation(ctx.db, memberId, participantId, accept, ctx.now());
          if (!result.ok) throw refusal(result);
          return reply.code(204).send();
        },
      );
    }

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
