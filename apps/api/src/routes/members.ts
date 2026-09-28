import { companyMember, companyMembers, invitedMember, inviteMemberRequest, updateMemberRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, HttpError, idOrNotFound, notFound } from "../http-error.ts";
import { deactivateMember, inviteMember, listMembers, setProjectCreator, type InviteResult, type UpdateResult } from "../identity/members.ts";

const memberParams = z.object({ memberId: z.string() });

/** A refusal as an HTTP error: 403 for anyone but the Authorized Person, 404 for another Company's Member, else 409. */
function refusal(result: Exclude<InviteResult | UpdateResult, { ok: true }>): HttpError {
  if (result.reason === "forbidden") return forbidden();
  if (result.reason === "not_found") return notFound();
  return new HttpError(409, result.reason);
}

function unwrap(result: UpdateResult) {
  if (result.ok) return result.member;
  throw refusal(result);
}

// A Company's Members. The list is private to the Company; only its Authorized
// Person invites, flags Project Creators and deactivates.
export const memberRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/members", { schema: { response: { 200: companyMembers } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return { members: await listMembers(ctx.db, memberId) };
    });

    app.post(
      "/v1/members",
      { schema: { body: inviteMemberRequest, response: { 201: invitedMember } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await inviteMember(ctx.db, memberId, request.body, ctx.now(), ctx.config.invitationTtlMs);
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ memberId: result.memberId, invitation: result.invitation });
      },
    );

    app.patch(
      "/v1/members/:memberId",
      { schema: { params: memberParams, body: updateMemberRequest, response: { 200: companyMember } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const target = idOrNotFound(request.params.memberId);
        return unwrap(await setProjectCreator(ctx.db, memberId, target, request.body.canCreateProjects));
      },
    );

    app.post(
      "/v1/members/:memberId/deactivate",
      { schema: { params: memberParams, response: { 200: companyMember } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const target = idOrNotFound(request.params.memberId);
        return unwrap(await deactivateMember(ctx.db, memberId, target, ctx.now()));
      },
    );
  };
