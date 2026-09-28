import { acceptInvitationRequest, signInRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { HttpError } from "../http-error.ts";
import { acceptInvitation } from "../identity/invitations.ts";
import { endSession, signIn, startSession } from "../identity/sessions.ts";

export const sessionRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Sign in. Every failure is the same 401, so accounts can't be discovered.
    app.post("/v1/session", { schema: { body: signInRequest } }, async (request, reply) => {
      const { email, password } = request.body;
      const session = await signIn(ctx.db, "member", email, password, ctx.now(), ctx.config.sessionTtlMs);
      if (!session) throw new HttpError(401, "invalid_credentials");
      ctx.setSessionCookie(reply, session);
      return reply.code(204).send();
    });

    // Sign out (Members and Rabaed Engineers): the session ends on the server,
    // not just in the browser.
    app.delete("/v1/session", async (request, reply) => {
      if (request.sessionToken) await endSession(ctx.db, request.sessionToken, ctx.now());
      ctx.clearSessionCookie(reply);
      return reply.code(204).send();
    });

    // Accept an invitation: set a password and sign in.
    app.post("/v1/invitations/accept", { schema: { body: acceptInvitationRequest } }, async (request, reply) => {
      const now = ctx.now();
      const memberId = await acceptInvitation(ctx.db, request.body.token, request.body.password, now);
      if (!memberId) throw new HttpError(400, "invalid_invitation");
      const session = await startSession(ctx.db, { kind: "member", memberId }, now, ctx.config.sessionTtlMs);
      ctx.setSessionCookie(reply, session);
      return reply.code(204).send();
    });
  };
