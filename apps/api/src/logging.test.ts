import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "./logging.ts";

// The api's log is JSON lines that CloudWatch keeps and the monitoring stack
// reads (packages/infra/src/monitoring-stack.ts). No customer content: no
// query strings, no values from database errors.

// Shaped like pg's DatabaseError: the message and detail can quote the row.
class DatabaseError extends Error {
  severity = "ERROR";
  code = "23505";
  constraint = "company_name_key";
  detail = "Key (name)=(Acme Contracting) already exists.";
}

async function logsOf(route: (app: FastifyInstance) => void, url: string) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });
  const app = Fastify({ logger: loggerOptions(stream) });
  route(app);
  const response = await app.inject({ method: "GET", url, headers: { cookie: "rabaed_session=secret-token" } });
  await app.close();
  return { lines, response };
}

describe("api logs", () => {
  it("log each request's method and path, never its query string or headers", async () => {
    const { lines } = await logsOf((app) => app.get("/v1/projects", async () => []), "/v1/projects?search=Tower%20B");
    const text = JSON.stringify(lines);
    expect(text).not.toContain("Tower");
    expect(text).not.toContain("secret-token");
    expect(lines).toContainEqual(expect.objectContaining({ req: { method: "GET", path: "/v1/projects" } }));
  });

  it("log one line per response with its status code, which the api 5xx alarm counts", async () => {
    const { lines } = await logsOf((app) => app.get("/fails", async (_req, reply) => reply.code(503).send()), "/fails");
    expect(lines).toContainEqual(expect.objectContaining({ msg: "request completed", res: { statusCode: 503 } }));
  });

  it("log a database error's code and constraint, never its message or detail, which can hold customer values", async () => {
    const { lines, response } = await logsOf(
      (app) =>
        app.get("/boom", async (request, reply) => {
          request.log.error(new DatabaseError('duplicate key value violates unique constraint "company_name_key"'));
          return reply.code(500).send({ error: "internal" });
        }),
      "/boom",
    );
    expect(response.statusCode).toBe(500);
    const logged = lines.find((l) => l.err) as { err: Record<string, unknown> };
    expect(logged.err).toMatchObject({ type: "DatabaseError", code: "23505", constraint: "company_name_key" });
    expect(JSON.stringify(lines)).not.toContain("Acme");
    expect(logged.err.message).toBe("database error 23505");
    expect(String(logged.err.stack)).not.toContain("duplicate key");
  });

  it("log other errors with their message and stack", async () => {
    const { lines } = await logsOf(
      (app) =>
        app.get("/bug", async (request, reply) => {
          request.log.error(new TypeError("Cannot read properties of undefined"));
          return reply.code(500).send();
        }),
      "/bug",
    );
    const logged = lines.find((l) => l.err) as { err: Record<string, unknown> };
    expect(logged.err).toMatchObject({ type: "TypeError", message: "Cannot read properties of undefined" });
    expect(String(logged.err.stack)).toContain("logging.test.ts");
  });
});
