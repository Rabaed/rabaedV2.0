import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, logOutbox } from "./log.ts";

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
});
