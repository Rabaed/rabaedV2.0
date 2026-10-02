import { setTimeout as sleep } from "node:timers/promises";
import { smokeTest } from "../src/smoke.ts";

// Usage: SMOKE_URL=https://… SMOKE_VERSION=<commit> [SMOKE_ADMIN_URL=https://…] [SMOKE_ARABIC_FONT="Thmanyah Sans"] [SMOKE_DEMO_PASSWORD=…] tsx bin/smoke.ts
// With SMOKE_ADMIN_URL, it checks Rabaed Admin answers there and the customer address serves none of it.
// With SMOKE_DEMO_PASSWORD (a demo environment), it also checks visibility as two demo people.
// Retries for a few minutes, since new targets take a moment to turn healthy.
const url = process.env.SMOKE_URL;
const version = process.env.SMOKE_VERSION;
const adminUrl = process.env.SMOKE_ADMIN_URL || undefined;
const arabicFont = process.env.SMOKE_ARABIC_FONT || undefined;
const demoPassword = process.env.SMOKE_DEMO_PASSWORD || undefined;
if (!url || !version) {
  console.error("Set SMOKE_URL and SMOKE_VERSION");
  process.exit(2);
}

const deadline = Date.now() + 5 * 60_000;
for (let attempt = 1; ; attempt++) {
  const failures = await smokeTest({ url, adminUrl, version, arabicFont, demoPassword });
  if (failures.length === 0) {
    const checked = [
      adminUrl && `Rabaed Admin at ${adminUrl} and not on the customer address`,
      arabicFont && `Arabic in ${arabicFont}`,
      demoPassword && "visibility holds between the demo Projects",
    ].filter(Boolean);
    console.log(`smoke test passed: ${url} runs ${version} with its database${checked.map((c) => `, ${c}`).join("")}`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  if (Date.now() > deadline) {
    console.error("smoke test failed");
    process.exit(1);
  }
  await sleep(15_000);
}
