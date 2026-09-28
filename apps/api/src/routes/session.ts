import { acceptInvitationRequest, signInRequest, type SignInRequest } from "@rabaed/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { HttpError } from "../http-error.ts";
import { acceptInvitation } from "../identity/invitations.ts";
import { endSession, signIn, startSession, type Principal, type Session } from "../identity/sessions.ts";

/** Sets the new session cookie, ending whatever session the browser had before. */
async function replaceSession(ctx: AppContext, request: FastifyRequest, reply: FastifyReply, session: Session) {
  if (request.sessionToken) await endSession(ctx.db, request.sessionToken, ctx.now());
  ctx.setSessionCookie(reply, session);
}

/** Sign-in for Members (/v1/session) and Rabaed Engineers (/admin/v1/session). */
export const signInHandler =
  (ctx: AppContext, kind: Principal["kind"]) =>
  async (request: FastifyRequest<{ Body: SignInRequest }>, reply: FastifyReply) => {
    const { email, password } = request.body;
    const session = await signIn(ctx.db, kind, email, password, ctx.now(), ctx.config.sessionTtlMs);
    // Every failure is the same 401, so registered emails can't be discovered.
    if (!session) throw new HttpError(401, "invalid_credentials");
    await replaceSession(ctx, request, reply, session);
    return reply.code(204).send();
  };

export const sessionRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/v1/session", { schema: { body: signInRequest } }, signInHandler(ctx, "member"));

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
      await replaceSession(ctx, request, reply, session);
      return reply.code(204).send();
    });
  };
