import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { fastifyHandler, type NodeHandler } from "./vercel.ts";

// The handler is called as Vercel calls a Node function: with a plain request and response.
let server: Server | undefined;
async function serve(handler: NodeHandler): Promise<string> {
  server = createServer((request, response) => void handler(request, response).catch(() => response.writeHead(500).end("build failed")));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe("fastifyHandler", () => {
  it("hands each request to the Fastify app, path, method, body and cookies unchanged", async () => {
    const url = await serve(
      fastifyHandler(async () => {
        const app = Fastify();
        app.post("/v1/echo", async (request, reply) => reply.header("set-cookie", "a=1; HttpOnly").send({ path: request.url, body: request.body, cookie: request.headers.cookie }));
        return app;
      }),
    );
    const response = await fetch(`${url}/v1/echo?x=1`, { method: "POST", headers: { "content-type": "application/json", cookie: "rabaed_session=t" }, body: JSON.stringify({ a: 1 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe("a=1; HttpOnly");
    expect(await response.json()).toEqual({ path: "/v1/echo?x=1", body: { a: 1 }, cookie: "rabaed_session=t" });
  });

  it("builds the app once per instance, however many requests arrive at once", async () => {
    let builds = 0;
    const url = await serve(
      fastifyHandler(async () => {
        builds += 1;
        const app = Fastify();
        app.get("/health", async () => ({ ok: true }));
        return app;
      }),
    );
    const answers = await Promise.all([1, 2, 3].map(() => fetch(`${url}/health`).then((r) => r.status)));
    expect(answers).toEqual([200, 200, 200]);
    expect(builds).toBe(1);
  });

  it("builds again after a failed build instead of failing every later request", async () => {
    let attempts = 0;
    const url = await serve(
      fastifyHandler(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("database not ready");
        const app = Fastify();
        app.get("/health", async () => ({ ok: true }));
        return app;
      }),
    );
    expect((await fetch(`${url}/health`)).status).toBe(500);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect(attempts).toBe(2);
  });
});
