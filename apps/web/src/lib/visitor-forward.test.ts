import { afterEach, describe, expect, it, vi } from "vitest";
import { visitorForwardHeaders, visitorForwardSecretFromEnv } from "./visitor-forward.ts";

// RP-1230: on Vercel the api sees web's egress address, so web names the visitor its own incoming
// X-Forwarded-For holds (Vercel sets it to the browser's address) with VISITOR_FORWARD_SECRET as the key.
// Built at run time, so no secret-like literal is in the source.
const SECRET = "s".repeat(48);
const BROWSER = "203.0.113.7";

afterEach(() => vi.unstubAllEnvs());

describe("the headers web sends the api for a visitor", () => {
  it("name the visitor, with the secret as the key, beside X-Forwarded-For", () => {
    expect(visitorForwardHeaders(BROWSER, SECRET)).toEqual({ "x-forwarded-for": BROWSER, "x-rabaed-visitor": BROWSER, "x-rabaed-visitor-key": SECRET });
  });

  it("name the last X-Forwarded-For entry, the address the proxy in front of web saw", () => {
    expect(visitorForwardHeaders(`10.9.9.9, ${BROWSER}`, SECRET)["x-rabaed-visitor"]).toBe(BROWSER);
  });

  it("are X-Forwarded-For alone without a secret (today's behaviour)", () => {
    expect(visitorForwardHeaders(BROWSER, undefined)).toEqual({ "x-forwarded-for": BROWSER });
  });

  it("are none without an X-Forwarded-For: no key goes without a visitor", () => {
    expect(visitorForwardHeaders(null, SECRET)).toEqual({});
    expect(visitorForwardHeaders(" , ", SECRET)).toEqual({});
  });
});

describe("VISITOR_FORWARD_SECRET on web", () => {
  it("is taken when it has 32 characters or more", () => {
    vi.stubEnv("VISITOR_FORWARD_SECRET", SECRET);
    expect(visitorForwardSecretFromEnv()).toBe(SECRET);
  });

  it("is no secret when unset or empty", () => {
    vi.stubEnv("VISITOR_FORWARD_SECRET", "");
    expect(visitorForwardSecretFromEnv()).toBeUndefined();
    expect(visitorForwardSecretFromEnv({})).toBeUndefined();
  });

  it("stops web starting when it is shorter than 32 characters, never printing it", () => {
    const short = "k".repeat(31);
    expect(() => visitorForwardSecretFromEnv({ VISITOR_FORWARD_SECRET: short })).toThrow(/VISITOR_FORWARD_SECRET/);
    expect(() => visitorForwardSecretFromEnv({ VISITOR_FORWARD_SECRET: short })).toThrow(expect.objectContaining({ message: expect.not.stringContaining(short) }));
  });
});
