import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkReachable, hostAndPort, tcpReachable, unreachable, waitForMailpit } from "./test-services.ts";

describe("hostAndPort", () => {
  it("reads the host and port of a database or HTTP URL, with the scheme's default port", () => {
    expect(hostAndPort("postgres://u:p@localhost:5932/rabaed")).toEqual({ host: "localhost", port: 5932 });
    expect(hostAndPort("postgres://u:p@db/rabaed")).toEqual({ host: "db", port: 5432 });
    expect(hostAndPort("http://127.0.0.1:8525")).toEqual({ host: "127.0.0.1", port: 8525 });
    expect(hostAndPort("http://[::1]:9500")).toEqual({ host: "::1", port: 9500 });
  });
});

describe("checkReachable", () => {
  it("names every service that doesn't answer, with its port and the command to start it", async () => {
    const reachable = async (_host: string, port: number) => port === 9500;
    await expect(
      checkReachable(
        [
          { name: "Postgres", url: "postgres://u:p@localhost:5932/postgres" },
          { name: "The file store", url: "http://127.0.0.1:9500" },
          { name: "Mailpit", url: undefined },
        ],
        reachable,
      ),
    ).rejects.toThrow(/^Postgres for this worktree \(port 5932\) isn't reachable: run `docker compose up -d --wait db mailpit files`\.$/);
  });

  it("passes when every service answers", async () => {
    await expect(checkReachable([{ name: "Postgres", url: "postgres://u:p@localhost:5932/postgres" }], async () => true)).resolves.toBeUndefined();
  });
});

describe("tcpReachable", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("sees a listener, and nothing on a closed port", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    expect(await tcpReachable("127.0.0.1", port)).toBe(true);
    server.close();
    await new Promise((resolve) => server!.once("close", resolve));
    expect(await tcpReachable("127.0.0.1", port)).toBe(false);
  });
});

describe("waitForMailpit", () => {
  it("waits until /readyz answers 200", async () => {
    const asked: string[] = [];
    let calls = 0;
    const get = (async (url: URL) => {
      asked.push(url.pathname);
      calls++;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    await waitForMailpit("http://127.0.0.1:8525", { intervalMs: 1, get });
    expect(asked).toEqual(["/readyz", "/readyz", "/readyz"]);
  });

  it("gives up after the timeout with the start command", async () => {
    const get = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(waitForMailpit("http://127.0.0.1:8525", { timeoutMs: 20, intervalMs: 5, get })).rejects.toThrow(unreachable("Mailpit", 8525));
  });
});
