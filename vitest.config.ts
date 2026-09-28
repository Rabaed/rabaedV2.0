import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

// Three suites, each run on its own in CI:
// - unit:  pure logic, no database.
// - seam1: the API called as a given signed-in Member, against a real Postgres.
// - seam2: the database as the app role with a Member set (RLS defence in depth).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "seam1",
          include: ["apps/api/test/**/*.test.ts"],
          globalSetup: ["packages/db/test-support/global-setup.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "seam2",
          include: ["packages/db/test/**/*.test.ts"],
          globalSetup: ["packages/db/test-support/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
