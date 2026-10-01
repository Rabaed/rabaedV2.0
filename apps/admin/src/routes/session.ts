import { signInRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { cookieNames, HttpError, type AdminContext } from "../app.ts";
import { checkCode, checkPassword, endSession } from "../sign-in.ts";

// Browsers drop a cookie after 400 days at most.
const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 3600;

export const sessionRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Step one: the password. The code goes to the Engineer's email.
    app.post(
      "/v1/sign-in",
      { schema: { body: signInRequest, response: { 202: z.object({ codeSentTo: z.string() }) } } },
      async (request, reply) => {
        const outcome = await checkPassword(ctx.db, ctx.mailer, request.body, ctx.seen(request), ctx.now());
        if (outcome.kind === "invalid_credentials") throw new HttpError(401, "invalid_credentials");
        if (outcome.kind === "too_many_codes") throw new HttpError(429, "too_many_codes");
        ctx.setCookie(reply, "challenge", outcome.challenge.token, { expires: outcome.challenge.expiresAt });
        return reply.code(202).send({ codeSentTo: outcome.email });
      },
    );

    // Step two: the code, in the same browser.
    app.post("/v1/sign-in/code", { schema: { body: z.object({ code: z.string().trim().regex(/^\d{6}$/) }) } }, async (request, reply) => {
      const { cookies } = request;
      const outcome = await checkCode(
        ctx.db,
        ctx.mailer,
        { challenge: cookies[cookieNames.challenge], code: request.body.code, deviceToken: cookies[cookieNames.device] },
        ctx.seen(request),
        ctx.now(),
      );
      if (outcome.kind === "invalid_code") throw new HttpError(401, "invalid_code");
      ctx.clearCookie(reply, "challenge");
      // A session cookie: it goes when the browser closes, and the server ends it sooner when idle.
      ctx.setCookie(reply, "session", outcome.session.token);
      if (outcome.newDeviceToken) ctx.setCookie(reply, "device", outcome.newDeviceToken, { maxAge: DEVICE_COOKIE_MAX_AGE_S });
      return reply.code(204).send();
    });

    app.delete("/v1/session", async (request, reply) => {
      const token = request.cookies[cookieNames.session];
      if (token) await endSession(ctx.db, token, ctx.seen(request), ctx.now());
      ctx.clearCookie(reply, "session");
      return reply.code(204).send();
    });

    app.get(
      "/v1/me",
      { schema: { response: { 200: z.object({ engineer: z.object({ id: z.uuid(), email: z.string(), fullName: z.string() }) }) } } },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        const engineer = await ctx.db
          .selectFrom("rabaed_engineer")
          .select(["id", "email", "full_name"])
          .where("id", "=", engineerId)
          .executeTakeFirstOrThrow();
        return { engineer: { id: engineer.id, email: engineer.email, fullName: engineer.full_name } };
      },
    );
  };
