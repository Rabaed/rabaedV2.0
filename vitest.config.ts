import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
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
// Seam tests drive whole Workflows through the API or the database; 5 s is too tight on CI.
// With other lanes' runs on the machine (RP-607) a test that makes 50 items took over 20 s, and
// the afterAll that closes its pools then waited past the 10 s hook default on the requests
// still in flight: one budget for both, with room for load, that still stops a hung test.
// Under several lanes' verify, 60 s was too tight too: work-item-list-dates.test.ts timed
// out at 60 s and passed 10/10 alone (RP-949).
const seamTimeout = 180_000;

// Vitest's default is a fork per CPU but one, for every run: with several lanes testing at once
// (5 Mains x 4 lanes, RP-602) that is dozens of forks contending for one machine (RP-607). A
// quarter of the CPUs runs the unit suite as fast here (20 CPUs: 36 s at 5 forks, 38 s at 19).
// The seam suites run one file at a time anyway (fileParallelism: false).
const maxWorkers = Math.max(2, Math.floor(availableParallelism() / 4));

export default defineConfig({
  test: {
    maxWorkers,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "packages/db/test-support/**/*.test.ts", "apps/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
          // next-intl's ESM imports `next/navigation` without an extension, which Node
          // can't resolve; run through Vite it resolves, so web pages render in a test.
          server: { deps: { inline: ["next-intl"] } },
        },
      },
      {
        test: {
          name: "seam1",
          testTimeout: seamTimeout,
          hookTimeout: seamTimeout,
          include: ["apps/api/test/**/*.test.ts", "apps/admin/test/**/*.test.ts"],
          globalSetup: ["scripts/test-services.ts", "packages/db/test-support/global-setup.ts", "apps/api/test/support/seed-demo.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "seam2",
          testTimeout: seamTimeout,
          hookTimeout: seamTimeout,
          include: ["packages/db/test/**/*.test.ts"],
          globalSetup: ["scripts/test-services.ts", "packages/db/test-support/global-setup.ts", "apps/api/test/support/seed-demo.ts"],
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
          globalSetup: ["scripts/test-services.ts"],
        },
      },
    ],
  },
});
