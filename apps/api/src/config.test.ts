import { describe, expect, it } from "vitest";
import { apiConfigFromEnv } from "./config.ts";

describe("api config", () => {
  it("reports the deployed commit as its version", () => {
    expect(apiConfigFromEnv({ APP_VERSION: "4f2a9c1" }).version).toBe("4f2a9c1");
  });

  it("is version `local` when nothing was deployed", () => {
    expect(apiConfigFromEnv({}).version).toBe("local");
  });

  it("keeps Documents to 50 MB of the default file types unless configured", () => {
    const { documents } = apiConfigFromEnv({});
    expect(documents.maxBytes).toBe(50 * 1024 * 1024);
    expect(documents.contentTypes).toContain("application/pdf");
  });

  describe("VISITOR_FORWARD_SECRET, the key that lets web name the visitor a limit counts (RP-1230)", () => {
    it.each([
      ["unset", {}],
      ["empty", { VISITOR_FORWARD_SECRET: "" }],
    ])("is no secret when %s, so the api counts the direct caller as before", (_name, env) => {
      expect(apiConfigFromEnv(env).visitorForwardSecret).toBeUndefined();
    });

    it("is taken when it has 32 characters or more", () => {
      const secret = "k".repeat(32);
      expect(apiConfigFromEnv({ VISITOR_FORWARD_SECRET: secret }).visitorForwardSecret).toBe(secret);
    });

    it("stops the api starting when it is shorter than 32 characters", () => {
      expect(() => apiConfigFromEnv({ VISITOR_FORWARD_SECRET: "k".repeat(31) })).toThrow(/VISITOR_FORWARD_SECRET/);
    });

    it("never prints the short secret in the error", () => {
      const short = "q".repeat(31);
      expect(() => apiConfigFromEnv({ VISITOR_FORWARD_SECRET: short })).toThrow(expect.objectContaining({ message: expect.not.stringContaining(short) }));
    });
  });

  it("takes the Document limits from the environment", () => {
    expect(apiConfigFromEnv({ DOCUMENT_MAX_MB: "5", DOCUMENT_CONTENT_TYPES: "application/pdf, Image/PNG" }).documents).toEqual({
      maxBytes: 5 * 1024 * 1024,
      contentTypes: ["application/pdf", "image/png"],
    });
  });
});
