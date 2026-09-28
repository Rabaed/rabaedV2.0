import { setTimeout as sleep } from "node:timers/promises";
import { smokeTest } from "../src/smoke.ts";

// Usage: SMOKE_URL=https://… SMOKE_VERSION=<commit> tsx bin/smoke.ts
// Retries for a few minutes, since new targets take a moment to turn healthy.
const url = process.env.SMOKE_URL;
const version = process.env.SMOKE_VERSION;
if (!url || !version) {
  console.error("Set SMOKE_URL and SMOKE_VERSION");
  process.exit(2);
}

const deadline = Date.now() + 5 * 60_000;
for (let attempt = 1; ; attempt++) {
  const failures = await smokeTest({ url, version });
  if (failures.length === 0) {
    console.log(`smoke test passed: ${url} runs ${version} with its database`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  if (Date.now() > deadline) {
    console.error("smoke test failed");
    process.exit(1);
  }
  await sleep(15_000);
}
