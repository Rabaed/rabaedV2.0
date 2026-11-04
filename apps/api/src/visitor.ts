import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Who is asking, for a limit on a public route: the last X-Forwarded-For entry, the address the
 * proxy in front of web saw. web forwards the browser's header; on AWS the load balancer appended
 * the address it saw (its `append` mode), so whatever a browser wrote before it was ignored. What
 * the last entry holds when web calls the api on Vercel is still to be checked (RP-1230).
 * Without one (local, tests), the caller.
 */
export function visitorOf(request: FastifyRequest): string {
  const last = [request.headers["x-forwarded-for"]]
    .flat()
    .join(",")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "")
    .at(-1);
  return last ?? request.ip;
}

/** The visitor's address as the database keeps it for a limit: its SHA-256, never the address. */
export const visitorSha256 = (request: FastifyRequest): Buffer => createHash("sha256").update(visitorOf(request), "utf8").digest();
