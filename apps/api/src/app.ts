import { pingDatabase, withMember, type Db } from "@rabaed/db";
import { healthResponse } from "@rabaed/domain";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { sql } from "kysely";
import { z } from "zod";

export interface Identity {
  memberId: string;
}

/** Resolves the signed-in Member from a request, or null when there is none. */
export type Authenticate = (request: FastifyRequest) => Promise<Identity | null>;

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

export interface AppOptions {
  db: Db;
  authenticate: Authenticate;
  logger?: boolean;
}

const uuid = z.uuid();

export async function buildApp({ db, authenticate, logger = true }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest("identity", null);
  app.addHook("onRequest", async (request) => {
    const identity = await authenticate(request);
    request.identity = identity && uuid.safeParse(identity.memberId).success ? identity : null;
  });

  /** The signed-in Member, or a 401 reply. */
  const requireMember = (request: FastifyRequest): Identity => {
    if (!request.identity) throw Object.assign(new Error("Not signed in"), { statusCode: 401 });
    return request.identity;
  };

  app.get(
    "/health",
    { schema: { response: { 200: healthResponse, 503: healthResponse } } },
    async (_request, reply) => {
      const ok = await pingDatabase(db);
      return reply
        .code(ok ? 200 : 503)
        .send(ok ? { status: "ok", database: "ok" } : { status: "degraded", database: "unavailable" });
    },
  );

  app.get(
    "/v1/me",
    { schema: { response: { 200: z.object({ memberId: z.uuid() }) } } },
    async (request) => {
      const { memberId } = requireMember(request);
      // Read back through the database so the route proves the Member reaches RLS.
      const row = await withMember(db, memberId, (trx) =>
        sql<{ member_id: string }>`select app.current_member_id() as member_id`.execute(trx),
      );
      return { memberId: row.rows[0]!.member_id };
    },
  );

  return app;
}
