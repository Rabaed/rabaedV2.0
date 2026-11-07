import { createHash, timingSafeEqual } from "node:crypto";
import { lastForwardedEntry, VISITOR_HEADER, VISITOR_KEY_HEADER } from "@rabaed/domain";
import type { FastifyRequest } from "fastify";

const sha256 = (text: string): Buffer => createHash("sha256").update(text, "utf8").digest();

/** Whether `key` is the secret: compared in constant time, as equal-length digests. */
function isSecret(key: string | string[] | undefined, secret: string): boolean {
  return typeof key === "string" && key !== "" && timingSafeEqual(sha256(key), sha256(secret));
}

/**
 * Who is asking, for a limit on a public route.
 *
 * On Vercel the api's X-Forwarded-For holds web's egress address, shared by every visitor (Vercel
 * overwrites the header at each hop), so web names the visitor in `x-rabaed-visitor`, its own
 * incoming X-Forwarded-For, which Vercel set to the browser's address. The api believes that only
 * with `x-rabaed-visitor-key` equal to `secret` (VISITOR_FORWARD_SECRET), so no one else can name a
 * visitor. Otherwise, and when the api has no secret: the last X-Forwarded-For entry, the direct
 * caller as the proxy in front of the api saw it; without one (local, tests), the connection's.
 */
export function visitorOf(request: FastifyRequest, secret: string | undefined): string {
  if (secret && isSecret(request.headers[VISITOR_KEY_HEADER], secret)) {
    const named = lastForwardedEntry(request.headers[VISITOR_HEADER]);
    if (named) return named;
  }
  return lastForwardedEntry(request.headers["x-forwarded-for"]) ?? request.ip;
}

/** The visitor's address as the database keeps it for a limit: its SHA-256, never the address. */
export const visitorSha256 = (request: FastifyRequest, secret: string | undefined): Buffer => sha256(visitorOf(request, secret));
