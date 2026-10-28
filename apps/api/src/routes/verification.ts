import { createHash } from "node:crypto";
import {
  parseVerificationCode,
  recordVerification,
  VERIFICATION_ATTEMPTS,
  verificationToken,
  verifyByCodeRequest,
  verifyByLinkRequest,
  type RecordVerification,
} from "@rabaed/domain";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { sql } from "kysely";
import type { AppContext } from "../app.ts";
import { HttpError, notFound } from "../http-error.ts";
import { visitorSha256 } from "../visitor.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

const tooManyAttempts = () => new HttpError(429, "too_many_attempts");

/**
 * Both routes' refusals are one answer: a body that doesn't parse, has the wrong type, is too long or
 * too large gets the plain 404 a record that doesn't exist gets, never a 400, 413 or 415 that would tell
 * a prober how far it got. The 429 and a server error stay what they are.
 */
function refuseAsNotFound(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) return reply.code(error.statusCode).send({ ...error.details, error: error.code });
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) return reply.code(404).send({ error: "not_found" });
  request.log.error(error);
  return reply.code(500).send({ error: "internal" });
}

// The public verification of a Documental Record (RP-157; ADR 0023; visibility.md, the Verification
// page row, scenario RP-23-4): anyone, signed in or not, with no cookie needed. It answers only the
// record's printed face (`recordVerification`, nothing more: the response schema drops anything else),
// for a published record. Everything else, a made-up link, a code alone, a wrong pair, a malformed
// body, a record being prepared or one that failed its checks, is the plain 404. Both are POSTs, so
// neither the link's token nor a typed code is in a logged path.
export const verificationRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    const route = { config: { public: true }, errorHandler: refuseAsNotFound, schema: { response: { 200: recordVerification } } } as const;

    // The QR's long link: 32 random bytes, which can't be guessed, so it isn't limited.
    app.post("/v1/verification/link", route, async (request) => {
      const body = verifyByLinkRequest.safeParse(request.body);
      const token = body.success ? verificationToken.safeParse(body.data.token) : null;
      if (!token?.success) throw notFound();
      const { rows } = await sql<{ verification: RecordVerification | null }>`
        select app.verify_documental_record_by_token(${sha256(token.data)}) as verification
      `.execute(ctx.db);
      const verification = rows[0]?.verification;
      if (!verification) throw notFound();
      return verification;
    });

    // The short code typed with the Document Number: attempts are limited per visitor, so records
    // can't be walked through by guessing. A JSON body of the wrong shape counts as an attempt too.
    app.post("/v1/verification/code", route, async (request) => {
      const body = verifyByCodeRequest.safeParse(request.body ?? {});
      const code = body.success ? (parseVerificationCode(body.data.code) ?? "") : "";
      const documentNumber = body.success ? body.data.documentNumber : "";
      const { rows } = await sql<{ outcome: "found" | "not_found" | "too_many_attempts"; verification: RecordVerification | null }>`
        select outcome, verification from app.verify_documental_record_by_code(
          ${code}, ${documentNumber}, ${visitorSha256(request)}, ${ctx.now()},
          ${VERIFICATION_ATTEMPTS.perVisitor}::integer, make_interval(mins => ${VERIFICATION_ATTEMPTS.windowMinutes}::integer)
        )
      `.execute(ctx.db);
      const found = rows[0];
      if (found?.outcome === "too_many_attempts") throw tooManyAttempts();
      if (found?.outcome !== "found" || !found.verification) throw notFound();
      return found.verification;
    });
  };
