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

  it("takes the Document limits from the environment", () => {
    expect(apiConfigFromEnv({ DOCUMENT_MAX_MB: "5", DOCUMENT_CONTENT_TYPES: "application/pdf, Image/PNG" }).documents).toEqual({
      maxBytes: 5 * 1024 * 1024,
      contentTypes: ["application/pdf", "image/png"],
    });
  });
});
