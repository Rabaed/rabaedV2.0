import { describe, expect, it, vi } from "vitest";
import { pageOutcome, readApiJson, valueOf, type ApiRead } from "./api-read.ts";

// RP-1049: a read that is slow or fails must never look like a page the Member may not
// see (docs/visibility.md, Direct URL row): only the api's own 4xx is "absent".

const url = "http://api.internal:4000/v1/projects/p1/modules/submittals/work-items?q=tower&page=2";

function reader(respond: (signal: AbortSignal) => Promise<Response>) {
  const log = vi.fn<(line: string) => void>();
  const fetch = vi.fn((_: string, init: RequestInit) => respond(init.signal as AbortSignal));
  return { log, fetch, read: <T>(timeoutMs = 50) => readApiJson<T>(url, { cookie: "s=1", timeoutMs }, { fetch, log }) };
}

describe("a server-side api read", () => {
  it("is the body when the api answers 200, sent with the session cookie and no cache", async () => {
    const { read, fetch, log } = reader(async () => Response.json({ items: [1] }));
    expect(await read<{ items: number[] }>()).toEqual({ kind: "ok", value: { items: [1] } });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { cookie: "s=1" }, cache: "no-store" });
    expect(log).not.toHaveBeenCalled();
  });

  it("is absent when the api answers 404 or 403: hidden and missing read the same, and that is not a fault to log", async () => {
    for (const status of [404, 403, 401]) {
      const { read, log } = reader(async () => new Response("{}", { status }));
      expect(await read()).toEqual({ kind: "absent" });
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("failed, and logged, when the api answers 5xx", async () => {
    const { read, log } = reader(async () => new Response("boom", { status: 503 }));
    expect(await read()).toEqual({ kind: "failed" });
    expect(log).toHaveBeenCalledWith("api read GET /v1/projects/p1/modules/submittals/work-items failed: status 503");
  });

  it("failed, and logged, for any other 4xx: a refused query (400) or a busy api (429) is not a hidden page", async () => {
    for (const status of [400, 409, 429]) {
      const { read, log } = reader(async () => new Response("{}", { status }));
      expect(await read()).toEqual({ kind: "failed" });
      expect(log).toHaveBeenCalledWith(`api read GET /v1/projects/p1/modules/submittals/work-items failed: status ${status}`);
    }
  });

  it("failed, and logged, when the api takes longer than the time limit", async () => {
    const { read, log } = reader(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    expect(await read(20)).toEqual({ kind: "failed" });
    expect(log).toHaveBeenCalledWith("api read GET /v1/projects/p1/modules/submittals/work-items failed: no answer within 20 ms");
  });

  it("failed, and logged, when the api can't be reached or its body isn't JSON", async () => {
    const down = reader(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await down.read()).toEqual({ kind: "failed" });
    expect(down.log).toHaveBeenCalledWith("api read GET /v1/projects/p1/modules/submittals/work-items failed: TypeError");

    // A parse error's message quotes the body; only its name is logged.
    const garbled = reader(async () => new Response("<html>Riyadh Gate Tower</html>", { status: 200 }));
    expect(await garbled.read()).toEqual({ kind: "failed" });
    expect(garbled.log).toHaveBeenCalledWith("api read GET /v1/projects/p1/modules/submittals/work-items failed: SyntaxError");
  });

  it("logs the path only: never the query string the Member typed, nor the api's body", async () => {
    const { read, log } = reader(async () => new Response("Riyadh Gate Tower secret", { status: 500 }));
    await read();
    expect(log.mock.calls[0]?.[0]).not.toMatch(/tower|page=|secret/i);
  });
});

describe("a read's value", () => {
  it("is the body when it was read, and null otherwise or when it wasn't asked for", () => {
    expect(valueOf({ kind: "ok", value: 3 })).toBe(3);
    expect(valueOf({ kind: "absent" })).toBeNull();
    expect(valueOf({ kind: "failed" })).toBeNull();
    expect(valueOf(null)).toBeNull();
  });
});

describe("what a page shows from its reads", () => {
  const ok: ApiRead<unknown> = { kind: "ok", value: {} };
  const absent: ApiRead<unknown> = { kind: "absent" };
  const failed: ApiRead<unknown> = { kind: "failed" };

  it("shows the page when every read it needs answered", () => {
    expect(pageOutcome(ok, [ok, null])).toBe("show");
  });

  it("is not found when the api says the Project (or what the page needs) is not there for this Member", () => {
    expect(pageOutcome(absent, [ok])).toBe("not-found");
    expect(pageOutcome(ok, [absent])).toBe("not-found");
  });

  it("is not found when the Project is hidden, whatever else failed: the Project read decides visibility", () => {
    expect(pageOutcome(absent, [failed])).toBe("not-found");
  });

  it("failed, never not found, when a read was slow or broke", () => {
    expect(pageOutcome(failed, [ok])).toBe("failed");
    expect(pageOutcome(ok, [failed])).toBe("failed");
    expect(pageOutcome(ok, [absent, failed])).toBe("failed");
    expect(pageOutcome(failed, [absent])).toBe("failed");
  });
});
