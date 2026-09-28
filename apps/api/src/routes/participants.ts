import {
  addParticipantRequest,
  addProjectMemberRequest,
  companyParticipations,
  participantMembers,
  projectParticipants,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, HttpError, idOrNotFound, notFound } from "../http-error.ts";
import {
  addParticipant,
  addProjectMember,
  listCompanyParticipations,
  listParticipantMembers,
  listParticipants,
  removeProjectMember,
  type AddParticipantResult,
  type ProjectMemberResult,
} from "../projects/participants.ts";

/** A refusal as an HTTP error. `not_found` is the Project or Participant itself: a plain 404. */
function refusal(result: Exclude<AddParticipantResult | ProjectMemberResult, { ok: true }>): HttpError {
  switch (result.reason) {
    case "forbidden":
      return forbidden();
    case "not_found":
      return notFound();
    case "member_not_found":
      return new HttpError(404, "member_not_found");
    case "unknown_company":
      return new HttpError(422, "unknown_company");
    case "already_participant":
      return new HttpError(409, "already_participant");
  }
}

const participantParams = z.object({ participantId: z.string() });

// Participants of a Project, and each Participant's Project Members. The
// Project's Members see its Participants; only a Participant's own Company sees
// its Project Members, and only its Authorized Person changes them.
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
        return { participants };
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
      const memberId = ctx.requireMember(request);
      const participants = await listCompanyParticipations(ctx.db, memberId);
      if (!Array.isArray(participants)) throw forbidden();
      return { participants };
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
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await addProjectMember(ctx.db, memberId, participantId, request.body.memberId);
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.delete(
      "/v1/participants/:participantId/members/:memberId",
      { schema: { params: participantParams.extend({ memberId: z.string() }) } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        const result = await removeProjectMember(ctx.db, memberId, participantId, target, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
