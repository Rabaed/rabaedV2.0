import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Who is asking, for a limit on a public route: the address the load balancer saw. Only web reaches
 * the api (packages/infra app-stack.ts), and it forwards the browser's X-Forwarded-For, to which the
 * load balancer appended the address it saw (its `append` mode, pinned in app-stack.ts): the last
 * entry. Whatever a browser wrote before it is ignored. Without one (local, tests), the caller.
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
