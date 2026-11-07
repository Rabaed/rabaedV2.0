import { afterEach, describe, expect, it, vi } from "vitest";

// The verification page's reads (RP-157) as the api sees them: the visitor web names (RP-1230).
vi.mock("server-only", () => ({}));
const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));

const { verifyByCode, verifyByLink } = await import("./verification.ts");

// Built at run time, so no secret-like literal is in the source.
const SECRET = "v".repeat(40);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Runs `read` with web's incoming headers and returns the headers it sent the api. */
async function sentHeaders(read: () => Promise<unknown>, headers: Record<string, string>): Promise<Headers> {
  incoming.headers = new Headers(headers);
  const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await read()).toEqual({ kind: "not_found" });
  const [, sent] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return new Headers(sent.headers);
}

describe.each([
  ["a typed code", () => verifyByCode("ABCD-EFGH", "VER-0001")],
  ["the QR's link", () => verifyByLink("token")],
])("the verification page's read by %s", (_name, read) => {
  it("names the visitor web's X-Forwarded-For holds, with VISITOR_FORWARD_SECRET as the key", async () => {
    vi.stubEnv("VISITOR_FORWARD_SECRET", SECRET);
    const sent = await sentHeaders(read, { "x-forwarded-for": "203.0.113.7" });
    expect([sent.get("x-forwarded-for"), sent.get("x-rabaed-visitor"), sent.get("x-rabaed-visitor-key")]).toEqual(["203.0.113.7", "203.0.113.7", SECRET]);
  });

  it("sends X-Forwarded-For alone without a secret (today's behaviour)", async () => {
    const sent = await sentHeaders(read, { "x-forwarded-for": "203.0.113.7", "x-rabaed-visitor": "198.51.100.9" });
    expect([sent.get("x-forwarded-for"), sent.get("x-rabaed-visitor"), sent.get("x-rabaed-visitor-key")]).toEqual(["203.0.113.7", null, null]);
  });
});
