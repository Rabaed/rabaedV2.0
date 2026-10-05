import {
  adminCounterStartRequest,
  adminNumbering,
  adminSaveNumberingPatternRequest,
  adminSetParticipantCodeRequest,
  counterStart,
  engineerReason,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import {
  readProjectNumbering,
  saveNumberingPattern,
  setNumberingCounterStart,
  setParticipantCode,
  type NumberingRefusal,
} from "../numbering.ts";

const refused = (reason: NumberingRefusal) => new HttpError(reason === "not_found" ? 404 : 409, reason);
// "invalid_code" is the sign-in code in this service; a malformed Participant Code is its own error.
const refusedCode = (reason: NumberingRefusal) => (reason === "invalid_code" ? new HttpError(409, "invalid_participant_code") : refused(reason));

// Numbering from Rabaed Admin (RP-317): a Rabaed Engineer sets a Project's Numbering
// Pattern, Participant Codes and starting numbers, each edit with a reason.
export const numberingRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    const signedIn = {
      onRequest: async (request: Parameters<AdminContext["requireEngineer"]>[0]) => {
        ctx.requireEngineer(request);
      },
    };
    const projectParams = z.object({ projectId: z.uuid() });

    app.get(
      "/v1/projects/:projectId/numbering",
      {
        ...signedIn,
        schema: { params: projectParams, querystring: z.object({ reason: engineerReason }), response: { 200: adminNumbering } },
      },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        const numbering = await readProjectNumbering(ctx.db, engineerId, request.params.projectId, request.query.reason, ctx.now());
        if (!numbering) throw new HttpError(404, "not_found");
        return numbering;
      },
    );

    app.post(
      "/v1/projects/:projectId/numbering-pattern",
      { ...signedIn, schema: { params: projectParams, body: adminSaveNumberingPatternRequest } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await saveNumberingPattern(ctx.db, engineerId, request.params.projectId, request.body, ctx.now());
        if (!result.ok) throw refused(result.reason);
        return reply.code(204).send();
      },
    );

    app.post(
      "/v1/participants/:participantId/code",
      { ...signedIn, schema: { params: z.object({ participantId: z.uuid() }), body: adminSetParticipantCodeRequest } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await setParticipantCode(ctx.db, engineerId, request.params.participantId, request.body);
        if (!result.ok) throw refusedCode(result.reason);
        return reply.code(204).send();
      },
    );

    app.post(
      "/v1/projects/:projectId/numbering-counters/start",
      { ...signedIn, schema: { params: projectParams, body: adminCounterStartRequest, response: { 200: counterStart } } },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await setNumberingCounterStart(ctx.db, engineerId, request.params.projectId, request.body, ctx.now());
        if (!result.ok) throw refused(result.reason);
        return result.value;
      },
    );
  };
