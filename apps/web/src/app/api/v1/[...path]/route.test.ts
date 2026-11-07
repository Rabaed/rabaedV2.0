import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route.ts";

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

  describe("RP-1230: the visitor a password-reset limit counts, on Vercel", () => {
    // Built at run time, so no secret-like literal is in the source.
    const secret = "v".repeat(40);
    afterEach(() => vi.unstubAllEnvs());

    it("names the visitor web's X-Forwarded-For holds, with VISITOR_FORWARD_SECRET as the key", async () => {
      vi.stubEnv("VISITOR_FORWARD_SECRET", secret);
      const sent = await forwardedHeaders(["password-resets"], { headers: { "x-forwarded-for": "203.0.113.7" } });
      expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
      expect(sent.get("x-rabaed-visitor")).toBe("203.0.113.7");
      expect(sent.get("x-rabaed-visitor-key")).toBe(secret);
    });

    it("never passes a visitor or key the browser sent, with a secret or without", async () => {
      const browser = { "x-forwarded-for": "203.0.113.7", "x-rabaed-visitor": "198.51.100.9", "x-rabaed-visitor-key": "a-guess" };
      const without = await forwardedHeaders(["password-resets"], { headers: browser });
      expect([without.get("x-rabaed-visitor"), without.get("x-rabaed-visitor-key")]).toEqual([null, null]);
      vi.stubEnv("VISITOR_FORWARD_SECRET", secret);
      const withSecret = await forwardedHeaders(["password-resets"], { headers: browser });
      expect([withSecret.get("x-rabaed-visitor"), withSecret.get("x-rabaed-visitor-key")]).toEqual(["203.0.113.7", secret]);
    });
  });

  it("passes no other browser header on", async () => {
    const sent = await forwardedHeaders(["session"], { headers: { authorization: "Bearer x", "x-other": "y" } });
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("x-other")).toBeNull();
  });

  it("passes a file the API sends itself back with its name and caching, byte for byte (a linked item's record, RP-1087)", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 record");
    const upstream = {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="RST-MAR-01-0001.pdf"',
      "cache-control": "private, no-store",
      "x-other": "y",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(pdf, { status: 200, headers: upstream })));
    const path = ["work-items", "x", "links", "l", "documental-record"];
    const res = await GET(new NextRequest(`http://web.test/api/v1/${path.join("/")}`), { params: Promise.resolve({ path }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(upstream["content-disposition"]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-other")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });
});
