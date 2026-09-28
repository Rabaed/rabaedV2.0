// Seam 2: bootstrap against a real Postgres.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

function withPassword(url: string, password: string): string {
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}

async function canConnect(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe("bootstrap", () => {
  // In AWS, Secrets Manager rotates the role passwords. A deploy's bootstrap
  // must not set them back to the values it read when its task started.
  it("with passwords owned by rotation, leaves existing roles' passwords alone", async () => {
    const urls = testDatabaseUrls();
    const stale = { ...urls, app: withPassword(urls.app, "stale-value-from-task-start") };

    await bootstrap(stale, { passwords: "on-create" });

    expect(await canConnect(urls.app)).toBe(true);
    expect(await canConnect(stale.app)).toBe(false);
  });
});
