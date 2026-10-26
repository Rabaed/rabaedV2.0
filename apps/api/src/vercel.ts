import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

export type NodeHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/**
 * A Vercel Function's handler for a Fastify app (ADR 0026): the app is built at
 * the first request of an instance and every request is handed to it unchanged,
 * so its routes, hooks and cookies are the same as under `listen` locally. A
 * failed build is not kept: the next request builds again.
 */
export function fastifyHandler(build: () => Promise<FastifyInstance>): NodeHandler {
  let app: Promise<FastifyInstance> | undefined;
  return async (request, response) => {
    app ??= build()
      .then(async (built) => {
        await built.ready();
        return built;
      })
      .catch((error: unknown) => {
        app = undefined;
        throw error;
      });
    (await app).server.emit("request", request, response);
  };
}
