import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.ts";

afterEach(() => vi.unstubAllGlobals());

/** Forwards `init` through the proxy to `path` and returns the headers the API was sent. */
async function forwardedHeaders(path: string[], init: { headers: Record<string, string> }): Promise<Headers> {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const request = new NextRequest(`http://web.test/api/v1/${path.join("/")}`, { method: "POST", body: "{}", ...init });
  await POST(request, { params: Promise.resolve({ path }) });
  const [, sent] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
  return new Headers(sent.headers);
}

describe("the /api/v1 proxy", () => {
  it("passes the visitor's X-Forwarded-For on, so the API's limits count each visitor (RP-1058)", async () => {
    const sent = await forwardedHeaders(["password-resets"], {
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7, 10.0.0.1");
    expect(sent.get("content-type")).toBe("application/json");
  });

  it("passes no other browser header on", async () => {
    const sent = await forwardedHeaders(["session"], { headers: { authorization: "Bearer x", "x-other": "y" } });
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("x-other")).toBeNull();
  });
});
