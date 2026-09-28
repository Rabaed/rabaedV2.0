import cookie from "@fastify/cookie";
import type { Db } from "@rabaed/db";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { ApiConfig } from "./config.ts";
import { HttpError, notFound, notSignedIn } from "./http-error.ts";
import { dummyHash } from "./identity/password.ts";
import { resolveSession, type Principal, type Session } from "./identity/sessions.ts";
import { adminRoutes } from "./routes/admin.ts";
import { companyRoutes } from "./routes/companies.ts";
import { healthRoutes } from "./routes/health.ts";
import { memberRoutes } from "./routes/members.ts";
import { sessionRoutes } from "./routes/session.ts";

export const SESSION_COOKIE = "rabaed_session";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
    sessionToken: string | null;
  }
}

export interface AppOptions {
  /** Connects as rabaed_app: row-level security applies. */
  db: Db;
  /** Connects as rabaed_admin: Rabaed Admin routes only, always through asEngineer. */
  adminDb: Db;
  config: ApiConfig;
  /** The current time; tests move it to check expiry. */
  now?: () => Date;
  logger?: boolean;
}

/** What route plugins get from the app. */
export interface AppContext {
  db: Db;
  adminDb: Db;
  config: ApiConfig;
  now: () => Date;
  /** The signed-in Member's id, or a 401. */
  requireMember(request: FastifyRequest): string;
  /** The signed-in Rabaed Engineer's id, or a 404: Rabaed Admin routes don't exist for anyone else. */
  requireEngineer(request: FastifyRequest): string;
  setSessionCookie(reply: FastifyReply, session: Session): void;
  clearSessionCookie(reply: FastifyReply): void;
}

export async function buildApp({
  db,
  adminDb,
  config,
  now = () => new Date(),
  logger = true,
}: AppOptions): Promise<FastifyInstance> {
  await dummyHash();
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);

  app.decorateRequest("principal", null);
  app.decorateRequest("sessionToken", null);
  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    request.sessionToken = token;
    request.principal = await resolveSession(db, token, now());
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code });
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ error: "invalid_request", issues: error.validation });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: "invalid_request" });
    request.log.error(error);
    return reply.code(500).send({ error: "internal" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));

  const cookieOptions = { path: "/", httpOnly: true, sameSite: "lax", secure: config.cookieSecure } as const;
  const context: AppContext = {
    db,
    adminDb,
    config,
    now,
    requireMember(request) {
      if (request.principal?.kind !== "member") throw notSignedIn();
      return request.principal.memberId;
    },
    requireEngineer(request) {
      if (request.principal?.kind !== "engineer") throw notFound();
      return request.principal.engineerId;
    },
    setSessionCookie(reply, session) {
      reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions, expires: session.expiresAt });
    },
    clearSessionCookie(reply) {
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
    },
  };

  await app.register(healthRoutes(context));
  await app.register(sessionRoutes(context));
  await app.register(companyRoutes(context));
  await app.register(memberRoutes(context));
  await app.register(adminRoutes(context), { prefix: "/admin" });
  return app;
}
