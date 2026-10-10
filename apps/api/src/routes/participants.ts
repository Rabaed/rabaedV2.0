import {
  addParticipantRequest,
  addProjectMemberRequest,
  companyInvitations,
  companyParticipations,
  participantMembers,
  projectInvitations,
  projectParticipants,
  removeProjectMemberRequest,
  setMemberPositionsRequest,
  setParticipantCodeRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
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
  setParticipantCode,
  withdrawInvitation,
} from "../projects/participants.ts";
import { refusal } from "../refusals.ts";

const participantParams = z.object({ participantId: z.string() });

// Participants of a Project, their invitations, and each Participant's Project
// Members. A Project Admin invites a Company by its CR number and gets one
// answer whether or not it is on Rabaed; the Company joins only when its
// Authorized Person accepts (ADR 0009). The Project Admin may withdraw any
// pending invitation, again with one answer for both kinds. A Project's
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
        return visibleOrNotFound(listParticipants(ctx.db, memberId, idOrNotFound(request.params.projectId)));
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

    // 204 with no body, alike for an invitation to a Company on Rabaed and for an
    // onboarding lead; a 404 for anyone but the Project's Project Admins (scenario 38).
    app.post(
      "/v1/projects/:projectId/invitations/:invitationId/withdraw",
      { schema: { params: z.object({ projectId: z.string(), invitationId: z.string() }) } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const invitationId = idOrNotFound(request.params.invitationId);
        const result = await withdrawInvitation(ctx.db, memberId, projectId, invitationId, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
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

    // A Project Admin sets the Participant Code; 404 for a Participant the Member can't see, 403 for
    // a Member who can see it but isn't a Project Admin.
    app.put(
      "/v1/participants/:participantId/code",
      { schema: { params: participantParams, body: setParticipantCodeRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await setParticipantCode(ctx.db, memberId, participantId, request.body.code);
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
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
        return visibleOrNotFound(listParticipantMembers(ctx.db, memberId, idOrNotFound(request.params.participantId)));
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
      { schema: { params: participantParams.extend({ memberId: z.string() }), body: removeProjectMemberRequest.nullish() } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        // Their Steps there are handed over first (RP-108): 409 handover_needed or nobody_can_take otherwise.
        const result = await removeProjectMember(ctx.db, actorId, participantId, target, ctx.now(), request.body?.handovers);
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
        const result = await setMemberPositions(
          ctx.db,
          actorId,
          participantId,
          target,
          request.body.positions,
          ctx.now(),
          request.body.handovers,
        );
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
