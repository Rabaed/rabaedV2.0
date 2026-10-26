import { setTimeout as sleep } from "node:timers/promises";
import { apiSmokeTest, smokeRunFromEnv, smokeTest, type SmokeRun } from "../src/smoke.ts";

// Usage, web (after every deploy):
//   SMOKE_URL=https://… SMOKE_VERSION=<commit> [SMOKE_ADMIN_URL=https://…] [SMOKE_ADMIN_BYPASS=…] [SMOKE_ARABIC_FONT="Thmanyah Sans"] [SMOKE_DEMO_PASSWORD=…] tsx bin/smoke.ts
// With SMOKE_ADMIN_URL, it checks Rabaed Admin answers there and the customer address serves none of it.
// With SMOKE_DEMO_PASSWORD (a demo environment), it also checks visibility as two demo people.
// Usage, the api before web is deployed (UAT on Vercel, RP-1043):
//   SMOKE_API_URL=https://… SMOKE_VERSION=<commit> SMOKE_DEMO_PASSWORD=… [SMOKE_ADMIN_URL=https://…] [SMOKE_ADMIN_BYPASS=…] tsx bin/smoke.ts
// It checks the api's version and database, and visibility asked of the api itself.
// SMOKE_ADMIN_BYPASS is Admin's Vercel Protection Bypass for Automation secret, sent to Admin only.
// Retries for a few minutes, since new targets take a moment to turn healthy.
const run = smokeRunFromEnv(process.env);
if ("error" in run) {
  console.error(run.error);
  process.exit(2);
}

const deadline = Date.now() + 5 * 60_000;
for (let attempt = 1; ; attempt++) {
  const failures = run.stage === "web" ? await smokeTest(run.options) : await apiSmokeTest(run.options);
  if (failures.length === 0) {
    console.log(`smoke test passed: ${passed(run)}`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  if (Date.now() > deadline) {
    console.error("smoke test failed");
    process.exit(1);
  }
  await sleep(15_000);
}

function passed(run: Exclude<SmokeRun, { error: string }>): string {
  if (run.stage === "api") {
    const { apiUrl, version, adminUrl } = run.options;
    return [`${apiUrl} runs ${version} with its database`, "visibility holds between the demo Projects on the api", adminUrl && `Rabaed Admin at ${adminUrl}`].filter(Boolean).join(", ");
  }
  const { url, version, adminUrl, arabicFont, demoPassword } = run.options;
  const checked = [
    adminUrl && `Rabaed Admin at ${adminUrl} and not on the customer address`,
    arabicFont && `Arabic in ${arabicFont}`,
    demoPassword && "visibility holds between the demo Projects",
  ].filter(Boolean);
  return `${url} runs ${version} with its database${checked.map((c) => `, ${c}`).join("")}`;
}
