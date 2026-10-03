import cookie, { type CookieSerializeOptions } from "@fastify/cookie";
import { dummyHash } from "@rabaed/auth";
import type { Db } from "@rabaed/db";
import type { Mailer } from "@rabaed/mailer";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { AdminConfig } from "./config.ts";
import { companyRoutes } from "./routes/companies.ts";
import { healthRoutes } from "./routes/health.ts";
import { optionListRoutes } from "./routes/option-lists.ts";
import { pageRoutes } from "./routes/pages.ts";
import { sessionRoutes } from "./routes/session.ts";
import { resolveSession, type Seen } from "./sign-in.ts";

// Rabaed Admin (ADR 0010): its own service, address and sign-in, never served
// by the customer app. The only process that holds the rabaed_admin role,
// which bypasses row-level security; every use of it for a Company's data goes
// through asEngineer, which writes admin_action with the Engineer's reason.

export const cookieNames = {
  session: "rabaed_admin_session",
  /** A sign-in waiting for its emailed code. */
  challenge: "rabaed_admin_challenge",
  /** Which browser this is, for the new-device alert. */
  device: "rabaed_admin_device",
} as const;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

declare module "fastify" {
  interface FastifyRequest {
    engineerId: string | null;
  }
}

export interface AdminAppOptions {
  /** Connects as rabaed_admin. */
  db: Db;
  config: AdminConfig;
  mailer: Mailer;
  /** The current time; tests move it to check expiry. */
  now?: () => Date;
  logger?: boolean;
}

/** What route plugins get from the app. */
export interface AdminContext {
  db: Db;
  config: AdminConfig;
  mailer: Mailer;
  now: () => Date;
  /** The signed-in Rabaed Engineer's id, or a 401. */
  requireEngineer(request: FastifyRequest): string;
  seen(request: FastifyRequest): Seen;
  setCookie(reply: FastifyReply, name: keyof typeof cookieNames, value: string, options?: CookieSerializeOptions): void;
  clearCookie(reply: FastifyReply, name: keyof typeof cookieNames): void;
}

// The pages load only their own script and styles, and are never framed.
const securityHeaders = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export async function buildAdminApp({ db, config, mailer, now = () => new Date(), logger = true }: AdminAppOptions): Promise<FastifyInstance> {
  await dummyHash();
  // Only the load balancer reaches the service (network stack). Trusting one
  // hop takes the address it saw, not one a client wrote into X-Forwarded-For.
  const app = Fastify({
    logger: logger && { serializers: { req: (request: FastifyRequest) => ({ method: request.method, path: request.url.split("?")[0] }) } },
    // The immediate peer (hop 0) is the load balancer; nothing before it is trusted.
    trustProxy: (_address: string, hop: number) => hop === 0,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);

  const seen = (request: FastifyRequest): Seen => ({
    ip: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
  });

  app.decorateRequest("engineerId", null);
  app.addHook("onRequest", async (request) => {
    const token = request.cookies[cookieNames.session];
    if (token) request.engineerId = await resolveSession(db, token, seen(request), now());
  });
  app.addHook("onSend", async (request, reply) => {
    reply.headers(securityHeaders);
    if (config.cookieSecure) reply.header("strict-transport-security", "max-age=31536000");
    if (request.url.startsWith("/v1/")) reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code });
    if (hasZodFastifySchemaValidationErrors(error)) return reply.code(400).send({ error: "invalid_request", issues: error.validation });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: "invalid_request" });
    // By type and code only: database messages can quote a row's values.
    request.log.error({ type: (error as Error).constructor?.name, code: (error as { code?: unknown }).code }, "request failed");
    return reply.code(500).send({ error: "internal" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));

  const cookieOptions = { path: "/", httpOnly: true, sameSite: "strict", secure: config.cookieSecure } as const;
  const context: AdminContext = {
    db,
    config,
    mailer,
    now,
    requireEngineer(request) {
      if (!request.engineerId) throw new HttpError(401, "not_signed_in");
      return request.engineerId;
    },
    seen,
    setCookie(reply, name, value, options = {}) {
      reply.setCookie(cookieNames[name], value, { ...cookieOptions, ...options });
    },
    clearCookie(reply, name) {
      reply.clearCookie(cookieNames[name], cookieOptions);
    },
  };

  await app.register(healthRoutes(context));
  await app.register(pageRoutes());
  await app.register(sessionRoutes(context));
  await app.register(companyRoutes(context));
  await app.register(optionListRoutes(context));
  return app;
}
