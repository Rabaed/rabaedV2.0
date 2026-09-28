import { describe, expect, it } from "vitest";
import { memberApiTarget } from "./api-url.ts";

const api = "http://api.internal:4000";

describe("the /api/v1 proxy's target", () => {
  it("is the same path under the api's /v1, with the query string", () => {
    expect(memberApiTarget(["companies", "c1", "members"], "?page=2", api)?.toString()).toBe(
      "http://api.internal:4000/v1/companies/c1/members?page=2",
    );
  });

  it("keeps each segment one segment", () => {
    expect(memberApiTarget(["a/b", "c?d"], "", api)?.pathname).toBe("/v1/a%2Fb/c%3Fd");
  });

  it("never leaves /v1, so Rabaed Admin is not reachable through web", () => {
    expect(memberApiTarget(["..", "admin", "companies"], "", api)).toBeNull();
    expect(memberApiTarget(["me", "..", "..", "admin"], "", api)).toBeNull();
    expect(memberApiTarget([".", "me"], "", api)).toBeNull();
  });
});
