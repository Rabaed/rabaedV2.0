import {
  addLocationRequest,
  addTradeRequest,
  dimensionKinds,
  dimensionValues,
  memberVisibility,
  participantVisibility,
  setVisibilityRequest,
  type DimensionKind,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, HttpError, idOrNotFound, notFound } from "../http-error.ts";
import {
  addDimensionValue,
  getMemberVisibility,
  getParticipantVisibility,
  listDimensions,
  myVisibility,
  setMemberVisibility,
  setParticipantVisibility,
  type AddValueResult,
  type SetVisibilityResult,
} from "../projects/visibility.ts";

/** A refusal as an HTTP error. `not_found` is the Project or Participant itself: a plain 404. */
function refusal(result: Exclude<AddValueResult | SetVisibilityResult, { ok: true }>): HttpError {
  switch (result.reason) {
    case "forbidden":
      return forbidden();
    case "not_found":
      return notFound();
    case "member_not_found":
      return new HttpError(404, "member_not_found");
    case "project_closed":
      return new HttpError(409, "project_closed");
    case "duplicate_code":
      return new HttpError(409, "duplicate_code");
    case "parent_not_found":
    case "too_deep":
    case "value_not_found":
    case "exceeds_participant":
      return new HttpError(422, result.reason);
  }
}

/** A dimension from the URL, or a 404 like any other path that doesn't exist. */
function kindOrNotFound(value: string): DimensionKind {
  if (!(dimensionKinds as readonly string[]).includes(value)) throw notFound();
  return value as DimensionKind;
}

const projectParams = z.object({ projectId: z.string() });
const participantParams = z.object({ participantId: z.string(), kind: z.string() });
const memberParams = participantParams.extend({ memberId: z.string() });
const created = z.object({ id: z.uuid() });

// A Project's Trades and Locations, and who covers which of them. Every Project
// Member sees the Trades and Locations; only a Project Admin changes them and
// grants each Participant Visibility; only a Participant's Authorized Person
// narrows it for its Project Members, whose grants only its own Company sees.
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
      {
        schema: {
          params: participantParams.omit({ kind: true }),
          response: { 200: participantVisibility },
        },
      },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await getParticipantVisibility(ctx.db, memberId, idOrNotFound(request.params.participantId));
        if (!result) throw notFound();
        return result;
      },
    );

    app.put(
      "/v1/participants/:participantId/visibility/:kind",
      { schema: { params: participantParams, body: setVisibilityRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const kind = kindOrNotFound(request.params.kind);
        const result = await setParticipantVisibility(ctx.db, memberId, participantId, kind, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.get(
      "/v1/participants/:participantId/members/:memberId/visibility",
      { schema: { params: memberParams.omit({ kind: true }), response: { 200: memberVisibility } } },
      async (request) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const result = await getMemberVisibility(ctx.db, actorId, participantId, idOrNotFound(request.params.memberId));
        if (!result) throw notFound();
        return result;
      },
    );

    app.put(
      "/v1/participants/:participantId/members/:memberId/visibility/:kind",
      { schema: { params: memberParams, body: setVisibilityRequest } },
      async (request, reply) => {
        const actorId = ctx.requireMember(request);
        const participantId = idOrNotFound(request.params.participantId);
        const target = idOrNotFound(request.params.memberId);
        const kind = kindOrNotFound(request.params.kind);
        const result = await setMemberVisibility(ctx.db, actorId, participantId, target, kind, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
