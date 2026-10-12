import { expect, test } from "vitest";

// Throwaway (RP-557 acceptance): one failing seam 1 test must turn its shard and the
// required check "seam 1 (API as a Member)" red. Reverted in the next commit.
test("a failing seam 1 shard fails the required check", () => {
  expect(1).toBe(2);
});
