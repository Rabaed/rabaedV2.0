import { describe, expect, it } from "vitest";
import { apiConfigFromEnv } from "./config.ts";

describe("api config", () => {
  it("reports the deployed commit as its version", () => {
    expect(apiConfigFromEnv({ APP_VERSION: "4f2a9c1" }).version).toBe("4f2a9c1");
  });

  it("is version `local` when nothing was deployed", () => {
    expect(apiConfigFromEnv({}).version).toBe("local");
  });
});
