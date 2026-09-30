import {
  companyMember,
  companyMembers,
  invitedMember,
  inviteMemberRequest,
  reactivatedMember,
  updateMemberRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { HttpError, idOrNotFound } from "../http-error.ts";
import {
  deactivateMember,
  inviteMember,
  listMembers,
  reactivateMember,
  setProjectCreator,
  type UpdateResult,
} from "../identity/members.ts";
import { refusal } from "../refusals.ts";

const memberParams = z.object({ memberId: z.string() });

/** The updated Member, or the refusal: 403 for anyone but the Authorized Person, 404 for another Company's Member, else 409. */
function unwrap(result: UpdateResult) {
  if (result.ok) return result.member;
  throw refusal(result);
}

// A Company's Members. The list is private to the Company; only its Authorized
// Person invites, flags Project Creators, deactivates and reactivates.
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
        // Their own Company's deactivated Member: the id, for the Authorized Person to confirm reactivating them.
        if (!result.ok && result.reason === "deactivated_member") {
          throw new HttpError(409, "deactivated_member", { memberId: result.memberId });
        }
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

    app.post(
      "/v1/members/:memberId/reactivate",
      { schema: { params: memberParams, response: { 200: reactivatedMember } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const target = idOrNotFound(request.params.memberId);
        const result = await reactivateMember(ctx.db, memberId, target, ctx.now(), ctx.config.invitationTtlMs);
        if (!result.ok) throw refusal(result);
        return { member: result.member, invitation: result.invitation };
      },
    );
  };
