import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, logOutbox } from "./log.ts";

// Shaped like pg's DatabaseError: the message and detail can quote the row.
class DatabaseError extends Error {
  severity = "ERROR";
  code = "23514";
  detail = "Failing row contains (Crack in the Tower B slab).";
}

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });
  return { lines, logger: createLogger(stream) };
}

describe("worker log", () => {
  it("is JSON lines, one per event", () => {
    const { lines, logger } = capture();
    logger.info("database ok");
    expect(lines).toEqual([expect.objectContaining({ level: 30, msg: "database ok" })]);
  });

  // The monitoring stack's outbox alarms read exactly these fields
  // (packages/infra/src/monitoring-stack.ts): counts only, no payloads.
  it("reports the outbox as { outbox: { backlog, oldestAgeSeconds } }", () => {
    const { lines, logger } = capture();
    logOutbox(logger, { backlog: 3, oldestAgeSeconds: 42 });
    expect(lines).toEqual([expect.objectContaining({ msg: "outbox", outbox: { backlog: 3, oldestAgeSeconds: 42 } })]);
  });

  it("logs a database error's code and class, never its message or detail, which can quote a Work Item title", () => {
    const { lines, logger } = capture();
    logger.error({ err: new DatabaseError('new row "Crack in the Tower B slab" violates check constraint') }, "outbox run failed");
    expect(JSON.stringify(lines)).not.toContain("Tower B");
    expect(lines).toEqual([
      expect.objectContaining({ msg: "outbox run failed", err: { type: "DatabaseError", code: "23514", message: "database error 23514" } }),
    ]);
  });

  it("logs other errors with their class and message", () => {
    const { lines, logger } = capture();
    logger.error({ err: new TypeError("fetch failed") }, "outbox run failed");
    expect(lines).toEqual([expect.objectContaining({ err: expect.objectContaining({ type: "TypeError", message: "fetch failed" }) })]);
  });
});
