import type { OutboxStats } from "@rabaed/db";
import { pino, type DestinationStream, type Logger } from "pino";

// The worker's log: JSON lines, like the api's, kept by CloudWatch in dev.
// Counts and states only; never an outbox row's payload, which is customer
// content.

/** `stream` is for tests (stdout otherwise). */
export function createLogger(stream?: DestinationStream): Logger {
  return stream ? pino(stream) : pino();
}

/**
 * One line per poll once the worker processes the outbox (RP-195). The
 * monitoring stack turns these fields into the outbox age and backlog alarms
 * (packages/infra/src/monitoring-stack.ts), so keep their names.
 */
export function logOutbox(logger: Logger, stats: OutboxStats): void {
  logger.info({ outbox: { backlog: stats.backlog, oldestAgeSeconds: stats.oldestAgeSeconds } }, "outbox");
}
