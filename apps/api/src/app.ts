import cookie from "@fastify/cookie";
import { dummyHash } from "@rabaed/auth";
import type { Db } from "@rabaed/db";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { ApiConfig } from "./config.ts";
import { noFileStore, type FileStore } from "./documents/file-store.ts";
import { HttpError, notSignedIn } from "./http-error.ts";
import { resolveSession, type Principal, type Session } from "./identity/sessions.ts";
import { loggerOptions } from "./logging.ts";
import { companyRoutes } from "./routes/companies.ts";
import { documentRoutes } from "./routes/documents.ts";
import { healthRoutes } from "./routes/health.ts";
import { homeRoutes } from "./routes/home.ts";
import { memberRoutes } from "./routes/members.ts";
import { notificationSettingsRoutes } from "./routes/notification-settings.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { numberingRoutes } from "./routes/numbering.ts";
import { numberingCounterRoutes } from "./routes/numbering-counters.ts";
import { optionListRoutes } from "./routes/option-lists.ts";
import { participantRoutes } from "./routes/participants.ts";
import { projectRoutes } from "./routes/projects.ts";
import { scopeRoutes } from "./routes/scopes.ts";
import { sessionRoutes } from "./routes/session.ts";
import { visibilityRoutes } from "./routes/visibility.ts";
import { watchRoutes } from "./routes/watch.ts";
import { workItemRoutes } from "./routes/work-items.ts";
import { workflowRoutes } from "./routes/workflows.ts";

export const SESSION_COOKIE = "rabaed_session";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
    sessionToken: string | null;
  }
}

// The customer api: what every Member's browser talks to, through web. It
// connects as rabaed_app only, which cannot bypass row-level security. Rabaed
// Admin, and the rabaed_admin role, live in their own service (apps/admin,
// ADR 0010); src/admin-boundary.test.ts keeps them out of here.

export interface AppOptions {
  /** Connects as rabaed_app: row-level security applies. */
  db: Db;
  config: ApiConfig;
  /** Where Documents' files live; the only signer of their URLs. Left out where nothing uploads (the demo seed). */
  files?: FileStore;
  /** The current time; tests move it to check expiry. */
  now?: () => Date;
  logger?: boolean;
}

/** What route plugins get from the app. */
export interface AppContext {
  db: Db;
  config: ApiConfig;
  files: FileStore;
  now: () => Date;
  /** The signed-in Member's id, or a 401. */
  requireMember(request: FastifyRequest): string;
  setSessionCookie(reply: FastifyReply, session: Session): void;
  clearSessionCookie(reply: FastifyReply): void;
}

export async function buildApp({
  db,
  config,
  files = noFileStore,
  now = () => new Date(),
  logger = true,
}: AppOptions): Promise<FastifyInstance> {
  await dummyHash();
  const app = Fastify({ logger: logger && loggerOptions() }).withTypeProvider<ZodTypeProvider>();
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
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ ...error.details, error: error.code });
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
    config,
    files,
    now,
    requireMember(request) {
      if (!request.principal) throw notSignedIn();
      return request.principal.memberId;
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
  await app.register(projectRoutes(context));
  await app.register(homeRoutes(context));
  await app.register(participantRoutes(context));
  await app.register(visibilityRoutes(context));
  await app.register(scopeRoutes(context));
  await app.register(workItemRoutes(context));
  await app.register(workflowRoutes(context));
  await app.register(documentRoutes(context));
  await app.register(notificationRoutes(context));
  await app.register(notificationSettingsRoutes(context));
  await app.register(watchRoutes(context));
  await app.register(optionListRoutes(context));
  await app.register(numberingRoutes(context));
  await app.register(numberingCounterRoutes(context));
  return app;
}
