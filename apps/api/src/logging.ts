import type { FastifyRequest, FastifyServerOptions } from "fastify";

// The api's log: JSON lines, kept by CloudWatch in dev and read by the
// monitoring stack (packages/infra/src/monitoring-stack.ts), which counts
// Fastify's "request completed" lines by res.statusCode. It holds no customer
// content: requests are logged by method and path only (paths carry ids, never
// names), and database errors by code and constraint only, because
// PostgreSQL's messages and details can quote the values of a row.

type LoggedError = Error & { code?: unknown; constraint?: unknown; severity?: unknown };

/** pg's DatabaseError: a SQLSTATE code and a severity. */
function isDatabaseError(error: LoggedError): boolean {
  return typeof error.severity === "string" && typeof error.code === "string";
}

function requestLog(request: FastifyRequest) {
  return { method: request.method, path: request.url.split("?")[0] };
}

function errorLog(error: LoggedError) {
  const type = error.constructor?.name ?? error.name;
  if (!isDatabaseError(error)) return { type, message: error.message, code: error.code, stack: error.stack ?? "" };
  // The stack's first line repeats the message; keep the frames only.
  const frames = (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line)).join("\n");
  return { type, message: `database error ${String(error.code)}`, code: error.code, constraint: error.constraint, stack: frames };
}

/** Fastify's logger settings; `stream` is for tests (stdout otherwise). */
export function loggerOptions(stream?: NodeJS.WritableStream): FastifyServerOptions["logger"] {
  return { serializers: { req: requestLog, err: errorLog }, ...(stream ? { stream } : {}) };
}
