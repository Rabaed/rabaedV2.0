import { setTimeout as sleep } from "node:timers/promises";
import { requestPasswordReset, resetPassword } from "@rabaed/auth";
import { PASSWORD_RESET, passwordResetRequest, resetPasswordRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { HttpError } from "../http-error.ts";
import { startSession } from "../identity/sessions.ts";
import { rememberBrowserLanguage } from "../notifications/settings.ts";
import { visitorSha256 } from "../visitor.ts";
import { replaceSession } from "./session.ts";

// Forgot password (RP-1058). Both routes are public POSTs, so neither the email nor the token is
// in a logged path; the api logs method and path only (logging.ts).
export const passwordResetRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Asks for a link. The same 202, in no less than PASSWORD_RESET.answerAfterMs, for any email:
    // the answer never tells whether it is registered. Past the limits, 429 for any email alike.
    app.post("/v1/password-resets", { config: { public: true }, schema: { body: passwordResetRequest } }, async (request, reply) => {
      const answerAt = performance.now() + PASSWORD_RESET.answerAfterMs;
      let outcome;
      try {
        outcome = await requestPasswordReset(ctx.db, request.body.email, visitorSha256(request), ctx.now(), PASSWORD_RESET);
      } finally {
        // Before anything is sent: a reply, once sent, has already told its time.
        await sleep(Math.max(0, answerAt - performance.now()));
      }
      if (outcome === "too_many_attempts") throw new HttpError(429, "too_many_attempts");
      return reply.code(202).send();
    });

    // Uses a link: sets the new password, signs the Member out everywhere else and in here. An
    // unknown, used, voided or expired link is one answer, `invalid_reset_link`.
    app.post("/v1/password-resets/complete", { config: { public: true }, schema: { body: resetPasswordRequest } }, async (request, reply) => {
      const now = ctx.now();
      const memberId = await resetPassword(ctx.db, request.body.token, request.body.password, now);
      if (!memberId) throw new HttpError(400, "invalid_reset_link");
      if (request.body.locale) await rememberBrowserLanguage(ctx.db, memberId, request.body.locale, now);
      const session = await startSession(ctx.db, { kind: "member", memberId }, now, ctx.config.sessionTtlMs);
      await replaceSession(ctx, request, reply, session);
      return reply.code(204).send();
    });
  };
