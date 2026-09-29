import type { OutboxStats } from "@rabaed/db";
import { pino, type DestinationStream, type Logger } from "pino";

// The worker's log: JSON lines, like the api's, kept by CloudWatch in dev.
// Counts and states only; never an outbox row's payload, which is customer
// content. Errors go under `err`, as in the api (apps/api/src/logging.ts): a
// database error by its class and code only, like the outbox's failureOf
// (packages/db/src/outbox.ts), because PostgreSQL's messages, details and
// stack can quote a row's values, such as a Work Item title.

type LoggedError = Error & { code?: unknown; severity?: unknown };

function errorLog(error: LoggedError) {
  const type = error.constructor?.name ?? error.name;
  const code = typeof error.code === "string" ? error.code : undefined;
  // pg's DatabaseError: a severity and a SQLSTATE (Node's EPIPE has no severity).
  if (typeof error.severity === "string" && code && /^[0-9A-Z]{5}$/.test(code)) {
    return { type, code, message: `database error ${code}` };
  }
  return { type, message: error.message, code, stack: error.stack ?? "" };
}

/** `stream` is for tests (stdout otherwise). */
export function createLogger(stream?: DestinationStream): Logger {
  const options = { serializers: { err: errorLog } };
  return stream ? pino(options, stream) : pino(options);
}

/**
 * One line per poll once the worker processes the outbox (RP-195). The
 * monitoring stack turns these fields into the outbox age and backlog alarms
 * (packages/infra/src/monitoring-stack.ts), so keep their names.
 */
export function logOutbox(logger: Logger, stats: OutboxStats): void {
  logger.info({ outbox: { backlog: stats.backlog, oldestAgeSeconds: stats.oldestAgeSeconds } }, "outbox");
}
