import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

// Five suites, each run on its own in CI:
// - unit:  pure logic, no database.
// - seam1: the API called as a given signed-in Member, and Rabaed Admin as a
//   signed-in Rabaed Engineer, against a real Postgres.
// - seam2: the database as the app role with a Member set (RLS defence in depth).
// Both run against the seeded setup: the demo Project `pnpm demo` builds is seeded
// into the test database first (RP-196).
// - infra: assertions on the synthesised AWS CloudFormation templates.
// - mail:  the mailer against the local mail catcher (Mailpit).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "seam1",
          include: ["apps/api/test/**/*.test.ts", "apps/admin/test/**/*.test.ts"],
          globalSetup: ["packages/db/test-support/global-setup.ts", "apps/api/test/support/seed-demo.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "seam2",
          include: ["packages/db/test/**/*.test.ts"],
          globalSetup: ["packages/db/test-support/global-setup.ts", "apps/api/test/support/seed-demo.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "infra",
          include: ["packages/infra/test/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "mail",
          include: ["packages/mailer/test/**/*.test.ts"],
        },
      },
    ],
  },
});
