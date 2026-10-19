import { createHash } from "node:crypto";
import {
  normalVerificationCode,
  recordVerification,
  VERIFICATION_ATTEMPTS,
  verificationToken,
  verifyByCodeRequest,
  verifyByLinkRequest,
  type RecordVerification,
} from "@rabaed/domain";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { sql } from "kysely";
import type { AppContext } from "../app.ts";
import { HttpError, notFound } from "../http-error.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

/**
 * Who is asking, for the limit on typed codes: the address the load balancer saw. Only web reaches
 * the api (packages/infra app-stack.ts), and it forwards the browser's X-Forwarded-For, to which the
 * load balancer appended the address it saw: the last entry. Without one (local, tests), the caller.
 */
function visitorOf(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const last = [forwarded]
    .flat()
    .join(",")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "")
    .at(-1);
  return last ?? request.ip;
}

const tooManyAttempts = () => new HttpError(429, "too_many_attempts");

// The public verification of a Documental Record (RP-157; ADR 0023; visibility.md, the Verification
// page row, scenario RP-23-4): anyone, signed in or not, with no cookie needed. It answers only what
// the record's first page already prints (`recordVerification`, nothing more: the response schema
// drops anything else), for a published record. Everything else, a made-up link, a code alone, a
// wrong pair, a record being prepared or one that failed its checks, is the plain 404. Both are
// POSTs, so neither the link's token nor a typed code is in a logged path.
export const verificationRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    // The QR's long link: 32 random bytes, which can't be guessed, so it isn't limited.
    app.post(
      "/v1/verification/link",
      { config: { public: true }, schema: { body: verifyByLinkRequest, response: { 200: recordVerification } } },
      async (request) => {
        const token = verificationToken.safeParse(request.body.token);
        if (!token.success) throw notFound();
        const { rows } = await sql<{ verification: RecordVerification | null }>`
          select app.verify_documental_record_by_token(${sha256(token.data)}) as verification
        `.execute(ctx.db);
        const verification = rows[0]?.verification ?? null;
        if (!verification) throw notFound();
        return verification;
      },
    );

    // The short code typed with the Document Number: attempts are limited per visitor, so records
    // can't be walked through by guessing.
    app.post(
      "/v1/verification/code",
      { config: { public: true }, schema: { body: verifyByCodeRequest, response: { 200: recordVerification } } },
      async (request) => {
        const { code, documentNumber } = request.body;
        const { rows } = await sql<{ outcome: "found" | "not_found" | "too_many_attempts"; verification: RecordVerification | null }>`
          select outcome, verification from app.verify_documental_record_by_code(
            ${normalVerificationCode(code) ?? ""}, ${documentNumber}, ${sha256(visitorOf(request))}, ${ctx.now()},
            ${VERIFICATION_ATTEMPTS.perVisitor}::integer, make_interval(mins => ${VERIFICATION_ATTEMPTS.windowMinutes}::integer)
          )
        `.execute(ctx.db);
        const found = rows[0];
        if (found?.outcome === "too_many_attempts") throw tooManyAttempts();
        if (found?.outcome !== "found" || !found.verification) throw notFound();
        return found.verification;
      },
    );
  };
